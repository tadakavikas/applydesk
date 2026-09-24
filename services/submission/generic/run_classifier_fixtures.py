#!/usr/bin/env python3
"""Print per-field confidence for generic career-page fixtures. No filling."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.submission.generic.field_classifier import classify_html_file

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def main() -> int:
    files = sorted(FIXTURES.glob("*.html"))
    if not files:
        print("no fixtures")
        return 1
    for path in files:
        result = classify_html_file(str(path))
        print("=" * 72)
        print(path.name)
        print(
            f"overall_confidence={result.overall_confidence}  "
            f"required={result.required_count}  fields={len(result.fields)}"
        )
        print(result.note)
        if not result.fields:
            print("  (no classifiable inputs)")
            continue
        print(
            f"  {'conf':>4}  {'req':<3}  {'type':<20}  {'input':<10}  label / name"
        )
        for f in result.fields:
            req = "Y" if f.required else ""
            label = (f.label or f.name).replace("\n", " ")[:72]
            print(
                f"  {f.confidence:4d}  {req:<3}  {f.field_type:<20}  {f.input_type:<10}  {label}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
