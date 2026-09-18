import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  LoaderCircle,
  Plane,
  Search,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { adminRpc, originalResumeUrl } from "./lib/admin-client";
import { profileLabels, type ResumeProfile } from "./lib/model";
import { exportResume, saveFile } from "./lib/resume-files";

type DataRow = Record<string, any>;
type Member = {
  user_id: string;
  full_name: string;
  email: string;
  status: "active" | "suspended";
  created_at: string;
  resume_count?: number;
  application_count?: number;
  admin_notes?: string;
};
type Detail = {
  member: Member;
  resumes: DataRow[];
  activity: DataRow[];
  applications: DataRow[];
  audit?: DataRow[];
  [key: string]: unknown;
};
const PAGE_SIZE = 25;
const date = (value: unknown) => {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
};
function profileOf(row: DataRow): ResumeProfile | null {
  const candidate = row.parsed_profile;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return null;
  return Object.fromEntries(
    Object.keys(profileLabels).map((key) => [
      key,
      typeof candidate[key] === "string" ? candidate[key] : "",
    ]),
  ) as ResumeProfile;
}
function RawData({
  data,
  label = "View complete record",
}: {
  data: unknown;
  label?: string;
}) {
  return (
    <details className="ss-raw">
      <summary>{label}</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
function Profile({ row }: { row: DataRow }) {
  const p = profileOf(row);
  return (
    <div className="ss-resume-readout">
      {p ? (
        Object.entries(profileLabels)
          .filter(([key]) => p[key as keyof ResumeProfile])
          .map(([key, label]) => (
            <section key={key}>
              <h4>{label}</h4>
              <p>{p[key as keyof ResumeProfile]}</p>
            </section>
          ))
      ) : (
        <p className="ss-prewrap">
          {row.resume_text ||
            "No parsed resume text was stored for this version."}
        </p>
      )}
      {p && row.resume_text && (
        <details>
          <summary>Full stored resume text</summary>
          <pre>{row.resume_text}</pre>
        </details>
      )}
    </div>
  );
}
function SafeEmployerLink({ url }: { url: unknown }) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return (
      <a
        className="ss-text-link"
        href={parsed.href}
        target="_blank"
        rel="noopener noreferrer"
      >
        Employer posting <ArrowUpRight size={14} />
      </a>
    );
  } catch {
    return null;
  }
}

export default function Admin() {
  const detailSection = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState("overview");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"active" | "suspended">("active");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setListError("");
    adminRpc("fn_ss_admin_list_members", {
      p_search: search,
      p_offset: page * PAGE_SIZE,
      p_limit: PAGE_SIZE,
    })
      .then((data) => {
        if (active) {
          setMembers(data.members || []);
          setTotal(Number(data.total || 0));
        }
      })
      .catch((e: Error) => {
        if (active) {
          setListError(e.message);
          setMembers([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, page, revision]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setDetailError("");
    setActionError("");
    adminRpc("fn_ss_admin_member_detail", { p_user_id: selected })
      .then((data) => {
        if (active) {
          setDetail(data);
          setNotes(data.member?.admin_notes || "");
          setStatus(data.member?.status || "active");
        }
      })
      .catch((e: Error) => {
        if (active) setDetailError(e.message);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected, revision]);
  useEffect(() => {
    if (selected && detailSection.current) {
      detailSection.current.focus({ preventScroll: true });
      detailSection.current.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    }
  }, [selected]);
  function openMember(member: Member) {
    setSelected(member.user_id);
    setTab("overview");
    setNotice("");
  }
  async function saveMember(e: FormEvent) {
    e.preventDefault();
    if (!detail || saving) return;
    setSaving(true);
    setNotice("");
    setActionError("");
    try {
      await adminRpc("fn_ss_admin_update_member", {
        p_user_id: detail.member.user_id,
        p_status: status,
        p_admin_notes: notes,
      });
      setNotice("Member settings saved.");
      setRevision((value) => value + 1);
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function downloadOriginal(path: unknown) {
    if (typeof path !== "string" || !path) return;
    setActionError("");
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const url = await originalResumeUrl(path);
      if (popup) popup.location.href = url;
      else {
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (e: any) {
      popup?.close();
      setActionError(e.message);
    }
  }
  async function downloadResume(row: DataRow, format: "pdf" | "docx") {
    const p = profileOf(row);
    if (!p) return;
    setActionError("");
    try {
      await exportResume(p, format, "applydesk-resume-snapshot");
    } catch (e: any) {
      setActionError(e.message);
    }
  }
  function resumeDownloads(row: DataRow) {
    return (
      <div className="ss-actions">
        {row.storage_path && (
          <button
            className="ss-button ss-small"
            onClick={() => void downloadOriginal(row.storage_path)}
          >
            <Download size={14} /> Original file
          </button>
        )}
        {profileOf(row) && (
          <>
            <button
              className="ss-button ss-small"
              onClick={() => void downloadResume(row, "pdf")}
            >
              PDF
            </button>
            <button
              className="ss-button ss-small"
              onClick={() => void downloadResume(row, "docx")}
            >
              Word
            </button>
          </>
        )}
        {row.resume_text && (
          <button
            className="ss-button ss-small"
            onClick={() =>
              saveFile(row.resume_text, "resume-snapshot.txt", "text/plain")
            }
          >
            Text
          </button>
        )}
        {row.latex_text && (
          <button
            className="ss-button ss-small"
            onClick={() =>
              saveFile(
                row.latex_text,
                "resume-snapshot.tex",
                "application/x-tex",
              )
            }
          >
            LaTeX
          </button>
        )}
      </div>
    );
  }
  const activeResumes =
    detail?.resumes?.filter(
      (resume) => !resume.archived_at && !resume.is_archived,
    ).length || 0;
  return (
    <div className="ss-admin">
      <header className="ss-header">
        <a className="ss-logo" href="index.html">
          <span className="ss-mark">
            <Plane size={23} />
          </span>
          applydesk<span>.</span>
        </a>
        <span className="ss-admin-label">
          <ShieldCheck size={16} /> ADMINISTRATION
        </span>
        <a className="ss-button" href="portal-v2.html">
          <ArrowLeft size={15} /> Mission Control
        </a>
      </header>
      <main className="ss-main">
        <div className="ss-heading">
          <div>
            <p className="ss-eyebrow">SELF-SERVICE PRODUCT</p>
            <h1>Members, in one place.</h1>
            <p>
              Manage independent job seekers and review their self-service
              activity.
            </p>
          </div>
          <span className="ss-separation">
            <Users size={18} /> Separate member directory
          </span>
        </div>
        <section
          className="ss-directory"
          aria-label="Self-service member directory"
        >
          <div className="ss-directory-toolbar">
            <div>
              <h2>Self-service members</h2>
              <p>Accounts created through ApplyDesk Self-service.</p>
            </div>
            <form
              className="ss-search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(query.trim());
                setPage(0);
              }}
            >
              <Search size={17} />
              <input
                aria-label="Search members by name or email"
                maxLength={200}
                type="search"
                placeholder="Search name or email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="ss-button ss-primary" type="submit">
                Search
              </button>
            </form>
          </div>
          {listError && (
            <div className="ss-alert" role="alert">
              {listError}
              <button onClick={() => setRevision((value) => value + 1)}>
                Retry
              </button>
            </div>
          )}
          <div className="ss-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Resumes</th>
                  <th>Applications</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="ss-empty" role="status">
                        <LoaderCircle className="spin" size={22} /> Loading
                        members…
                      </div>
                    </td>
                  </tr>
                ) : members.length ? (
                  members.map((member) => (
                    <tr key={member.user_id}>
                      <td>
                        <button
                          className="ss-member-name"
                          onClick={() => openMember(member)}
                        >
                          {member.full_name || "Unnamed member"}
                        </button>
                        <span className="ss-email">{member.email}</span>
                      </td>
                      <td>
                        <span className={`ss-status ${member.status}`}>
                          {member.status}
                        </span>
                      </td>
                      <td>{date(member.created_at)}</td>
                      <td>{member.resume_count ?? 0}</td>
                      <td>{member.application_count ?? 0}</td>
                      <td>
                        <button
                          className="ss-button ss-small"
                          onClick={() => openMember(member)}
                        >
                          View member <ArrowUpRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>
                      <div className="ss-empty">
                        <Users size={28} />
                        <strong>
                          {search
                            ? "No members match this search"
                            : "Your self-service directory starts here"}
                        </strong>
                        <p>
                          {search
                            ? "Try a different name or email address."
                            : "New self-service signups appear here. Existing managed clients stay in Mission Control."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="ss-pagination">
            <span>
              {total
                ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total} members`
                : "0 members"}
            </span>
            <div>
              <button
                className="ss-button ss-small"
                disabled={loading || page === 0}
                aria-label="Previous page"
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <button
                className="ss-button ss-small"
                disabled={loading || (page + 1) * PAGE_SIZE >= total}
                aria-label="Next page"
                onClick={() => setPage((value) => value + 1)}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </footer>
        </section>
        <p className="ss-directory-note">
          <ShieldCheck size={16} /> This directory is restricted to ApplyDesk
          administrators. Recruiter-managed clients and their records remain in
          Mission Control.
        </p>
        {selected && (
          <section
            className="ss-member-detail"
            aria-label="Member details"
            ref={detailSection}
            tabIndex={-1}
          >
            <div className="ss-detail-title">
              <div>
                <p className="ss-eyebrow">MEMBER DETAILS</p>
                <h2>{detail?.member?.full_name || "Self-service member"}</h2>
                <p>{detail?.member?.email}</p>
              </div>
              <button
                className="ss-button ss-small"
                aria-label="Close member details"
                onClick={() => {
                  setSelected(null);
                  setNotice("");
                }}
              >
                <X size={16} /> Close
              </button>
            </div>
            {detailLoading && (
              <div className="ss-empty" role="status">
                <LoaderCircle className="spin" /> Loading member data…
              </div>
            )}
            {detailError && (
              <div className="ss-alert" role="alert">
                {detailError}
                <button onClick={() => setRevision((value) => value + 1)}>
                  Retry
                </button>
              </div>
            )}
            {notice && (
              <div className="ss-notice" role="status">
                <CheckCircle2 size={17} />
                {notice}
              </div>
            )}
            {actionError && (
              <div className="ss-alert" role="alert">
                {actionError}
              </div>
            )}
            {detail && (
              <>
                <nav className="ss-tabs" aria-label="Member data sections">
                  {[
                    ["overview", "Account"],
                    ["resumes", `Resumes (${detail.resumes?.length || 0})`],
                    [
                      "activity",
                      `Saved & skipped (${detail.activity?.length || 0})`,
                    ],
                    [
                      "applications",
                      `Applications (${detail.applications?.length || 0})`,
                    ],
                    ["audit", "All data"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      className={tab === key ? "active" : ""}
                      aria-current={tab === key ? "page" : undefined}
                      onClick={() => setTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                <div className="ss-detail-content">
                  {tab === "overview" && (
                    <div className="ss-overview">
                      <div>
                        <div className="ss-stat-grid">
                          <div>
                            <FileText size={19} />
                            <strong>{activeResumes}</strong>
                            <span>Current resume versions</span>
                          </div>
                          <div>
                            <Bookmark size={19} />
                            <strong>
                              {detail.activity?.filter(
                                (item) => item.state === "saved",
                              ).length || 0}
                            </strong>
                            <span>Saved jobs</span>
                          </div>
                          <div>
                            <BriefcaseBusiness size={19} />
                            <strong>{detail.applications?.length || 0}</strong>
                            <span>Tracked applications</span>
                          </div>
                        </div>
                        <dl className="ss-facts">
                          <div>
                            <dt>Member ID</dt>
                            <dd>{detail.member.user_id}</dd>
                          </div>
                          <div>
                            <dt>Joined</dt>
                            <dd>{date(detail.member.created_at)}</dd>
                          </div>
                          <div>
                            <dt>Account status</dt>
                            <dd>
                              <span
                                className={`ss-status ${detail.member.status}`}
                              >
                                {detail.member.status}
                              </span>
                            </dd>
                          </div>
                        </dl>
                        <button
                          className="ss-button"
                          onClick={() =>
                            saveFile(
                              JSON.stringify(detail, null, 2),
                              `selfservice-member-${detail.member.user_id}.json`,
                              "application/json",
                            )
                          }
                        >
                          <Download size={16} /> Export member record
                        </button>
                      </div>
                      <form className="ss-account-form" onSubmit={saveMember}>
                        <h3>Account management</h3>
                        <label htmlFor="ss-status">Access status</label>
                        <select
                          id="ss-status"
                          value={status}
                          onChange={(e) =>
                            setStatus(e.target.value as "active" | "suspended")
                          }
                          disabled={saving}
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                        </select>
                        <p>
                          Suspending a member blocks self-service access while
                          retaining their data. Restore access by setting the
                          account to active.
                        </p>
                        <label htmlFor="ss-notes">Internal admin notes</label>
                        <textarea
                          id="ss-notes"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={5}
                          maxLength={10000}
                          placeholder="Notes visible only to administrators"
                          disabled={saving}
                        />
                        <button
                          className="ss-button ss-primary"
                          disabled={
                            saving ||
                            (notes === (detail.member.admin_notes || "") &&
                              status === detail.member.status)
                          }
                        >
                          {saving ? "Saving…" : "Save account changes"}
                        </button>
                      </form>
                    </div>
                  )}
                  {tab === "resumes" && (
                    <div className="ss-records">
                      {detail.resumes?.length ? (
                        detail.resumes.map((resume, index) => (
                          <details
                            className="ss-record"
                            key={resume.id || index}
                          >
                            <summary>
                              <FileText size={19} />
                              <span>
                                <strong>
                                  {resume.file_name || "Resume version"}
                                </strong>
                                <small>
                                  Uploaded {date(resume.created_at)}
                                </small>
                              </span>
                              <span className="ss-record-badges">
                                {resume.is_primary && (
                                  <span className="ss-status active">
                                    Primary
                                  </span>
                                )}
                                {(resume.archived_at || resume.is_archived) && (
                                  <span className="ss-status archived">
                                    Archived
                                  </span>
                                )}
                              </span>
                            </summary>
                            <div className="ss-record-body">
                              {resumeDownloads(resume)}
                              <Profile row={resume} />
                              <RawData data={resume} />
                            </div>
                          </details>
                        ))
                      ) : (
                        <div className="ss-empty">
                          <FileText size={25} />
                          <p>This member has not uploaded a resume.</p>
                        </div>
                      )}
                    </div>
                  )}
                  {tab === "activity" && (
                    <div className="ss-records">
                      {detail.activity?.length ? (
                        detail.activity.map((item, index) => {
                          const job = item.job || item.job_snapshot || {};
                          return (
                            <details
                              className="ss-record"
                              key={item.id || item.job_id || index}
                            >
                              <summary>
                                <Bookmark size={19} />
                                <span>
                                  <strong>{job.title || "Job listing"}</strong>
                                  <small>
                                    {job.company ||
                                      job.company_name ||
                                      "Employer"}{" "}
                                    · {date(item.updated_at || item.created_at)}
                                  </small>
                                </span>
                                <span className="ss-status archived">
                                  {item.state || item.action || "Activity"}
                                </span>
                              </summary>
                              <div className="ss-record-body">
                                <p>{job.location || job.location_text}</p>
                                <SafeEmployerLink
                                  url={job.url || job.apply_url}
                                />
                                <p className="ss-prewrap">
                                  {job.description ||
                                    job.description_text ||
                                    "No description stored."}
                                </p>
                                <RawData data={item} />
                              </div>
                            </details>
                          );
                        })
                      ) : (
                        <div className="ss-empty">
                          <Bookmark size={25} />
                          <p>No saved or skipped jobs yet.</p>
                        </div>
                      )}
                    </div>
                  )}
                  {tab === "applications" && (
                    <div className="ss-records">
                      {detail.applications?.length ? (
                        detail.applications.map((application, index) => {
                          const job =
                            application.job_snapshot || application.job || {};
                          const resume = application.resume_snapshot || {};
                          return (
                            <details
                              className="ss-record"
                              key={application.id || index}
                            >
                              <summary>
                                <BriefcaseBusiness size={19} />
                                <span>
                                  <strong>
                                    {job.title || "Tracked application"}
                                  </strong>
                                  <small>
                                    {job.company ||
                                      job.company_name ||
                                      "Employer"}{" "}
                                    · {date(application.created_at)}
                                  </small>
                                </span>
                                <span className="ss-status archived">
                                  {application.status || "opened"}
                                </span>
                              </summary>
                              <div className="ss-record-body">
                                <div className="ss-application-meta">
                                  <SafeEmployerLink
                                    url={
                                      job.url ||
                                      job.apply_url ||
                                      application.url
                                    }
                                  />
                                  <span>
                                    Match estimate:{" "}
                                    {application.match_score ??
                                      application.score ??
                                      "—"}
                                    {(application.match_score ??
                                      application.score) != null
                                      ? "%"
                                      : ""}
                                  </span>
                                </div>
                                <p className="ss-caption">
                                  Opening an employer page is tracked separately
                                  from the member marking an application as
                                  submitted.
                                </p>
                                <h3>Resume snapshot at handoff</h3>
                                <p className="ss-caption">
                                  This snapshot preserves the resume used at the
                                  time, even if the member later edits or
                                  replaces a resume.
                                </p>
                                {resumeDownloads(resume)}
                                <Profile row={resume} />
                                <div className="ss-actions">
                                  <button
                                    className="ss-button ss-small"
                                    onClick={() =>
                                      saveFile(
                                        JSON.stringify(application, null, 2),
                                        `application-${application.id || index}.json`,
                                        "application/json",
                                      )
                                    }
                                  >
                                    <Download size={14} /> Download application
                                    record
                                  </button>
                                </div>
                                <RawData data={application} />
                              </div>
                            </details>
                          );
                        })
                      ) : (
                        <div className="ss-empty">
                          <BriefcaseBusiness size={25} />
                          <p>No tracked applications yet.</p>
                        </div>
                      )}
                    </div>
                  )}
                  {tab === "audit" && (
                    <>
                      <div className="ss-data-header">
                        <div>
                          <h3>Stored member data</h3>
                          <p className="ss-caption">
                            Includes member metadata, archived versions, job
                            activity, application snapshots, and any recorded
                            administration history.
                          </p>
                        </div>
                        <button
                          className="ss-button"
                          onClick={() =>
                            saveFile(
                              JSON.stringify(detail, null, 2),
                              `selfservice-member-${detail.member.user_id}.json`,
                              "application/json",
                            )
                          }
                        >
                          <Download size={16} /> Export JSON
                        </button>
                      </div>
                      <RawData data={detail} label="Inspect all member data" />
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
