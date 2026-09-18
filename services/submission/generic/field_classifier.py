"""Classify unknown career-page form fields before any fill attempt.

Overall form confidence is the *lowest* per-field score among required
fields, not an average. One badly-misclassified required question tanks
the whole form — that is the field that causes real damage.
"""

from __future__ import annotations

import html as html_lib
import re
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from typing import Iterable

FIELD_TYPES = (
    "name",
    "email",
    "phone",
    "resume_upload",
    "cover_letter",
    "work_authorization",
    "sponsorship",
    "eeo",
    "unknown",
)

# Login / challenge controls are never application answers.
_SKIP_TYPES = frozenset({"hidden", "submit", "button", "reset", "image", "search"})
_SKIP_FIELD_TYPES = frozenset({"password"})

_WS = re.compile(r"\s+")


def _norm(value: str | None) -> str:
    return _WS.sub(" ", html_lib.unescape(value or "")).strip().lower()


@dataclass
class RawControl:
    tag: str
    attrs: dict[str, str]
    label: str = ""
    required: bool = False
    nearby_text: str = ""

    @property
    def input_type(self) -> str:
        if self.tag == "textarea":
            return "textarea"
        if self.tag == "select":
            return "select"
        return (self.attrs.get("type") or "text").lower()

    @property
    def name(self) -> str:
        return self.attrs.get("name") or self.attrs.get("id") or ""


@dataclass
class FieldClassification:
    name: str
    input_type: str
    label: str
    field_type: str
    confidence: int
    required: bool
    signals: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class FormClassification:
    fields: list[FieldClassification]
    overall_confidence: int
    required_count: int
    note: str = ""

    def to_dict(self) -> dict:
        return {
            "overall_confidence": self.overall_confidence,
            "required_count": self.required_count,
            "note": self.note,
            "fields": [f.to_dict() for f in self.fields],
        }


class _FormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.controls: list[RawControl] = []
        self._label_for: dict[str, str] = {}
        self._open_label: list[str] = []
        self._label_buf: list[str] = []
        self._open_field_text: list[list[str]] = []
        self._pending: RawControl | None = None
        self._in_option = False
        self._pending_label = ""
        self._label_started_at: list[int] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        ad = {k: (v or "") for k, v in attrs}
        if tag in {"div", "fieldset", "li", "section", "p"} and self._looks_like_field(ad, tag):
            self._open_field_text.append([])
        if tag == "label":
            self._open_label.append(ad.get("for") or "")
            self._label_buf.append("")
            self._label_started_at.append(len(self.controls))
        if tag in {"input", "textarea", "select"}:
            required = "required" in ad or ad.get("aria-required", "").lower() == "true"
            nearby = " ".join(" ".join(chunk) for chunk in self._open_field_text[-2:])
            self._pending = RawControl(tag=tag, attrs=ad, required=required, nearby_text=nearby)
            if self._pending_label and not self._pending.label:
                self._pending.label = self._pending_label
                self._pending.required = self._pending.required or ("*" in self._pending_label)
                self._pending_label = ""
            if tag == "input":
                self._finish_control()
        if tag == "option":
            self._in_option = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "label" and self._open_label:
            for_id = self._open_label.pop()
            text = self._label_buf.pop() if self._label_buf else ""
            started_at = self._label_started_at.pop() if self._label_started_at else len(self.controls)
            if for_id:
                self._label_for[for_id] = text
            elif started_at < len(self.controls):
                wrapped = self.controls[-1]
                if not wrapped.label:
                    wrapped.label = text
                    wrapped.required = wrapped.required or ("*" in text)
            else:
                self._pending_label = text
            if self._open_field_text:
                self._open_field_text[-1].append(text)
        if tag in {"textarea", "select"} and self._pending and self._pending.tag == tag:
            self._finish_control()
        if tag in {"div", "fieldset", "li", "section", "p"} and self._open_field_text:
            self._open_field_text.pop()
        if tag == "option":
            self._in_option = False

    def handle_data(self, data: str) -> None:
        if self._open_label and self._label_buf:
            self._label_buf[-1] += data
        if self._open_field_text:
            self._open_field_text[-1].append(data)

    def _finish_control(self) -> None:
        ctrl = self._pending
        self._pending = None
        if ctrl is None:
            return
        cid = ctrl.attrs.get("id") or ""
        if cid and cid in self._label_for:
            ctrl.label = self._label_for[cid]
        ctrl.required = ctrl.required or ("*" in ctrl.label)
        self.controls.append(ctrl)

    @staticmethod
    def _looks_like_field(ad: dict[str, str], tag: str) -> bool:
        cls = f"{ad.get('class', '')} {ad.get('id', '')}".lower()
        return bool(
            tag == "fieldset"
            or "field" in cls
            or "form-group" in cls
            or "question" in cls
            or "application" in cls
        )


# (field_type, regex, base_score, extra_when_type)
# Scores are "how sure we are of this type", not fill quality.
_RULES: list[tuple[str, re.Pattern[str], int, frozenset[str]]] = [
    (
        "email",
        re.compile(r"\be-?mail\b|emailaddress|applicant.?email"),
        96,
        frozenset({"email", "text"}),
    ),
    (
        "phone",
        re.compile(r"\b(phone|mobile|telephone|cell)\b"),
        94,
        frozenset({"tel", "text"}),
    ),
    (
        "resume_upload",
        re.compile(r"\b(resume|cv|curriculum vitae)\b"),
        95,
        frozenset({"file"}),
    ),
    (
        "cover_letter",
        re.compile(r"cover\s*letter|coverletter"),
        93,
        frozenset({"textarea", "file", "text"}),
    ),
    (
        "sponsorship",
        re.compile(
            r"sponsorship|require visa|immigration sponsorship|need a visa|"
            r"work visa|visa sponsorship|future require.{0,40}sponsor"
        ),
        92,
        frozenset({"radio", "select", "checkbox", "text"}),
    ),
    (
        "work_authorization",
        re.compile(
            r"authorized to work|legally authorized|work authorization|"
            r"eligible to work|right to work|employment eligibility|"
            r"work in the (united states|country|region)"
        ),
        92,
        frozenset({"radio", "select", "checkbox", "text"}),
    ),
    (
        "eeo",
        re.compile(
            r"\b(gender|sex assigned|veteran|disability|race|ethnicity|"
            r"hispanic|hispanic/latino|self-identification|eeo)\b"
        ),
        90,
        frozenset({"text", "select", "radio", "checkbox"}),
    ),
    (
        "name",
        re.compile(
            r"first name|given name|firstname|legal first|last name|surname|"
            r"family name|lastname|legal last|full name|preferred (first|last) name|"
            r"applicant name|legal name|\bname\b"
        ),
        88,
        frozenset({"text"}),
    ),
]


def _blob(ctrl: RawControl) -> str:
    parts = [
        ctrl.label,
        ctrl.attrs.get("aria-label"),
        ctrl.attrs.get("placeholder"),
        ctrl.attrs.get("name"),
        ctrl.attrs.get("id"),
        ctrl.nearby_text[:280],
        ctrl.attrs.get("autocomplete"),
    ]
    return _norm(" ".join(p for p in parts if p))


def classify_control(ctrl: RawControl) -> FieldClassification | None:
    itype = ctrl.input_type
    if itype in _SKIP_TYPES:
        return None
    if itype in _SKIP_FIELD_TYPES:
        return None

    blob = _blob(ctrl)
    if not blob:
        return FieldClassification(
            name=ctrl.name or "(unnamed)",
            input_type=itype,
            label=ctrl.label.strip(),
            field_type="unknown",
            confidence=15,
            required=ctrl.required,
            signals=["no label/name/placeholder"],
        )

    best: tuple[int, str, list[str]] | None = None
    for field_type, pattern, base, type_ok in _RULES:
        if not pattern.search(blob):
            continue
        score = base
        signals = [f"text:{field_type}"]
        if field_type == "name" and re.search(
            r"user.?name|company name|school name|file name|same as your|is your legal name",
            blob,
        ):
            continue
        if field_type == "name" and re.search(r"\bcity\b|country|employer", blob) and not re.search(
            r"first|last|full name|preferred", blob
        ):
            continue
        # "ethnicity" contains "city" as a substring — never treat as location/name.
        if field_type == "eeo" and re.search(r"ethnicity", blob):
            signals.append("ethnicity-not-city")
        if itype in type_ok:
            score = min(99, score + 4)
            signals.append(f"type:{itype}")
        elif field_type == "resume_upload" and itype != "file":
            score = min(score, 55)
            signals.append("resume-text-not-file")
        elif field_type in {"work_authorization", "sponsorship", "eeo"} and itype in {
            "text",
            "textarea",
        }:
            score -= 8
            signals.append("unexpected-free-text")
        # Label beats name/id-only.
        labeled = _norm(ctrl.label) or _norm(ctrl.attrs.get("aria-label"))
        if labeled and pattern.search(labeled):
            score = min(99, score + 3)
            signals.append("label-match")
        elif pattern.search(_norm(ctrl.attrs.get("name") or "") + " " + _norm(ctrl.attrs.get("id") or "")):
            score -= 12
            signals.append("name/id-only")
        if best is None or score > best[0]:
            best = (score, field_type, signals)

    if best is None:
        # Weak autocomplete hints.
        ac = _norm(ctrl.attrs.get("autocomplete"))
        if ac in {"email"}:
            return FieldClassification(ctrl.name, itype, ctrl.label.strip(), "email", 80, ctrl.required, ["autocomplete:email"])
        if ac in {"tel", "tel-national"}:
            return FieldClassification(ctrl.name, itype, ctrl.label.strip(), "phone", 78, ctrl.required, ["autocomplete:tel"])
        if ac in {"given-name", "family-name", "name"}:
            return FieldClassification(ctrl.name, itype, ctrl.label.strip(), "name", 82, ctrl.required, [f"autocomplete:{ac}"])
        return FieldClassification(
            name=ctrl.name or "(unnamed)",
            input_type=itype,
            label=ctrl.label.strip(),
            field_type="unknown",
            confidence=22,
            required=ctrl.required,
            signals=["no rule matched"],
        )

    score, field_type, signals = best
    return FieldClassification(
        name=ctrl.name or "(unnamed)",
        input_type=itype,
        label=ctrl.label.strip() or blob[:80],
        field_type=field_type,
        confidence=max(1, min(99, score)),
        required=ctrl.required,
        signals=signals,
    )


def classify_controls(controls: Iterable[RawControl]) -> FormClassification:
    fields = [c for c in (classify_control(ctrl) for ctrl in controls) if c is not None]
    required = [f for f in fields if f.required]
    if not fields:
        return FormClassification(
            fields=[],
            overall_confidence=0,
            required_count=0,
            note="no classifiable controls — listing/SPA shell, or login-only page",
        )
    pool = required or fields
    overall = min(f.confidence for f in pool)
    note = (
        "overall = min(required field confidence)"
        if required
        else "no required markers; overall = min(all classifiable fields)"
    )
    unknown_required = [f for f in required if f.field_type == "unknown"]
    if unknown_required:
        note += "; required unknown field(s) present — do not guess"
    return FormClassification(
        fields=fields,
        overall_confidence=overall,
        required_count=len(required),
        note=note,
    )


def classify_html(markup: str) -> FormClassification:
    parser = _FormParser()
    parser.feed(markup or "")
    parser.close()
    return classify_controls(parser.controls)


def classify_html_file(path: str) -> FormClassification:
    with open(path, encoding="utf-8", errors="replace") as fh:
        return classify_html(fh.read())
