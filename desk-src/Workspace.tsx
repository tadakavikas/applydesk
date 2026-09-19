"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Search,
  Bookmark,
  BriefcaseBusiness,
  FileText,
  MessageSquare,
  Plane,
  PlaneLanding,
  ShieldCheck,
  ArrowUpRight,
  ArrowRight,
  Plus,
  Sparkles,
  MapPin,
  Clock,
  Building2,
  Check,
  CheckCheck,
  RefreshCw,
  Upload,
  Download,
  X,
  ChevronRight,
  ExternalLink,
  Info,
  SlidersHorizontal,
  Star,
  Send,
  Copy,
  Link2,
  LogIn,
  LoaderCircle,
  GraduationCap,
  LayoutGrid,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Toaster } from "sonner";
import { api, openOriginal, downloadApplicationResume } from "./lib/api";
import { sb } from "./lib/client";
import { toast } from "sonner";
import {
  STATES,
  profileLabels,
  sections,
  parseProfile,
  emptyProfile,
  matchProfile,
  matchesJobQuery,
  resumeQuality,
  tailorProfile,
  sponsorshipLabel,
  feedAvailability,
  resumeSourceLabel,
  type ResumeSource,
  type ResumeProfile,
  type Resume,
  type Job,
  type Account,
  type Feed,
  type Activity,
} from "@/lib/model";
import { extractResume, exportResume } from "@/lib/resume-files";
type View = "jobs" | "saved" | "applications" | "resumes";
const nav = [
  { id: "jobs", icon: Search, label: "Find jobs" },
  { id: "saved", icon: Bookmark, label: "Saved jobs" },
  { id: "applications", icon: BriefcaseBusiness, label: "Applications" },
  { id: "resumes", icon: FileText, label: "My resumes" },
] as const;
const statuses = [
  "Started",
  "Applied",
  "Interview",
  "Offer",
  "Rejected",
  "Withdrawn",
];
function since(date: string) {
  const hours = Math.max(0, (Date.now() - Date.parse(date)) / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))}m ago`;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
function Picker({
  value,
  onChange,
  options,
  label,
  className = "",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  label: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className={"filter " + className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, t]) => (
          <SelectItem value={v} key={v}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Blank({
  icon: Icon = Search,
  title,
  children,
  action,
}: {
  icon?: typeof Search;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Empty className="empty-state">
      <EmptyHeader>
        <Icon className="empty-icon" />
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      {action}
    </Empty>
  );
}
function Meter({
  score,
  label = "Resume readiness",
}: {
  score: number;
  label?: string;
}) {
  return (
    <div className="meter">
      <div className="meter-number">
        <strong>{score.toFixed(1)}</strong>
        <span>/ 10</span>
        <Sparkles size={19} />
      </div>
      <div
        className="meter-bars"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={score}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            style={{
              background:
                i < score
                  ? `hsl(${30 + i * 12}, ${44 - i}%, ${65 - i * 2}%)`
                  : "#e8ede9",
            }}
          />
        ))}
      </div>
      <p>{label}</p>
    </div>
  );
}
function ResumePaper({ profile: p }: { profile: ResumeProfile }) {
  return (
    <article className="resume-paper">
      <h2>{p.name || "Your name"}</h2>
      <p className="paper-contact">
        {[p.phone, p.email, p.linkedin, p.location]
          .filter(Boolean)
          .join("  |  ")}
      </p>
      {sections
        .filter((k) => p[k])
        .map((k) => (
          <section key={k}>
            <h3>{profileLabels[k]}</h3>
            <p>{p[k]}</p>
          </section>
        ))}
    </article>
  );
}
export default function Workspace() {
  const [view, setView] = useState<View>("jobs"),
    [feed, setFeed] = useState<Feed | null>(null),
    [loading, setLoading] = useState(true),
    [feedError, setFeedError] = useState(""),
    [account, setAccount] = useState<Account | null>(null),
    [accountError, setAccountError] = useState(""),
    [accountLoading, setAccountLoading] = useState(true);
  const [query, setQuery] = useState(""),
    [days, setDays] = useState("30"),
    [employment, setEmployment] = useState("all"),
    [state, setState] = useState("all"),
    [mode, setMode] = useState("all"),
    [scope] = useState("h1b"),
    [sort, setSort] = useState("newest"),
    [jobTab, setJobTab] = useState("all");
  const [login, setLogin] = useState(false),
    [sourcesOpen, setSourcesOpen] = useState(false),
    [job, setJob] = useState<Job | null>(null),
    [jobStage, setJobStage] = useState<"review" | "tailor">("review"),
    [chosenResume, setChosenResume] = useState(""),
    [level, setLevel] = useState<"light" | "substantial">("light"),
    [confirmed, setConfirmed] = useState<string[]>([]),
    [tailored, setTailored] = useState<ResumeProfile | null>(null),
    [paperTab, setPaperTab] = useState("updated");
  const [uploadOpen, setUploadOpen] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [rawText, setRawText] = useState(""),
    [draft, setDraft] = useState<ResumeProfile>(emptyProfile()),
    [replaceId, setReplaceId] = useState<string | null>(null),
    [editingId, setEditingId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [selectedResume, setSelectedResume] = useState(""),
    [preferenceBusy, setPreferenceBusy] = useState(false),
    [handoffJobId, setHandoffJobId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null),
    uploadRef = useRef<HTMLInputElement>(null);
  const feedState = feedAvailability(feed);
  const resumeSource = account?.applicationResumeSource || "applydesk";
  const existingApplication = account?.activity.find(
    (a) => a.jobId === job?.id && a.action === "application",
  );
  const handoffApplication = account?.activity.find(
    (a) => a.jobId === handoffJobId && a.action === "application",
  );
  const primary =
    account?.resumes.find((r) => r.primary) || account?.resumes[0] || null;
  const activeResume =
    account?.resumes.find((r) => r.id === selectedResume) || primary;
  const applyingResume =
    account?.resumes.find((r) => r.id === chosenResume) || primary;
  const match = job
    ? matchProfile(applyingResume?.profile || null, job)
    : { score: null, matched: [], missing: [] };
  const afterMatch = job && tailored ? matchProfile(tailored, job) : null;
  const actions = new Map(account?.activity.map((a) => [a.jobId, a]) || []);
  async function refreshAccount() {
    try {
      const a = await api("account");
      setAccount(a);
      setAccountError("");
      return a as Account;
    } catch (e: any) {
      if (!e.signIn) setAccountError(e.message);
      else setAccount(null);
      return null;
    } finally {
      setAccountLoading(false);
    }
  }
  async function loadJobs() {
    setLoading(true);
    setFeedError("");
    try {
      setFeed(await api("jobs"));
    } catch (e: any) {
      setFeedError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadJobs();
    void refreshAccount();
    const refresh = setInterval(() => void loadJobs(), 900000);
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setView("jobs");
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      clearInterval(refresh);
      window.removeEventListener("keydown", key);
    };
  }, []);
  const filtered = useMemo(() => {
    let items =
      view === "saved"
        ? account?.activity
            .filter((a) => a.action === "saved")
            .map((a) => a.job) || []
        : view === "jobs" && jobTab === "skipped"
          ? account?.activity
              .filter((a) => a.action === "skipped")
              .map((a) => a.job) || []
          : feed?.jobs || [];
    return items
      .filter((j) => {
        const action = account?.activity.find((a) => a.jobId === j.id);
        if (
          view === "jobs" &&
          jobTab !== "skipped" &&
          action?.action === "skipped"
        )
          return false;
        if (
          view === "jobs" &&
          jobTab !== "skipped" &&
          scope === "h1b" &&
          j.sponsorship !== "h1b"
        )
          return false;
        if (!matchesJobQuery(j, query)) return false;
        if (
          view === "jobs" &&
          jobTab !== "skipped" &&
          (Date.now() - Date.parse(j.publishedAt)) / 86400000 > +days
        )
          return false;
        if (employment !== "all" && j.employment !== employment) return false;
        if (state !== "all" && !j.states.includes(state)) return false;
        if (mode !== "all" && j.workMode !== mode) return false;
        if (
          jobTab === "matches" &&
          (matchProfile(primary?.profile || null, j).score || 0) < 60
        )
          return false;
        return true;
      })
      .sort((a, b) =>
        sort === "match"
          ? (matchProfile(primary?.profile || null, b).score ?? -1) -
            (matchProfile(primary?.profile || null, a).score ?? -1)
          : Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      );
  }, [
    feed,
    account,
    view,
    query,
    days,
    employment,
    state,
    mode,
    scope,
    sort,
    jobTab,
    primary,
  ]);
  const requireAccount = () => {
    if (account) return true;
    setLogin(true);
    return false;
  };
  async function act(
    j: Job,
    action: "saved" | "skipped" | "application" | "remove",
    status?: string,
    snapshot?: ResumeProfile,
  ) {
    if (!requireAccount()) return;
    try {
      const data = await api("activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: j.id,
          action,
          status,
          resumeId: applyingResume?.id,
          resumeSnapshot: snapshot,
          resumeSource,
          score:
            snapshot && j
              ? matchProfile(snapshot, j).score
              : matchProfile(applyingResume?.profile || null, j).score,
        }),
      });
      await refreshAccount();
      return data;
    } catch (e: any) {
      toast.error(e.message);
      return null;
    }
  }
  function openJob(j: Job) {
    setJob(j);
    setChosenResume(primary?.id || "");
    setJobStage("review");
    setConfirmed([]);
    setTailored(null);
    setLevel("light");
  }
  function openUpload(replace?: string) {
    if (!requireAccount()) return;
    setFile(null);
    setRawText("");
    setDraft(emptyProfile());
    setReplaceId(replace || null);
    setEditingId(null);
    setUploadOpen(true);
  }
  async function parseFile(f: File) {
    setBusy(true);
    try {
      const text = await extractResume(f);
      setFile(f);
      setRawText(text);
      setDraft(parseProfile(text));
      toast.success("Resume read. Review your details before saving.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveResume() {
    setBusy(true);
    try {
      if (!draft.name.trim()) throw new Error("Add your name before saving.");
      if (editingId) {
        await api("resumes/" + editingId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: draft }),
        });
      } else {
        if (!file) throw new Error("Choose a resume file first.");
        const form = new FormData();
        form.set("file", file);
        form.set("text", rawText);
        form.set("profile", JSON.stringify(draft));
        if (replaceId) form.set("replaceId", replaceId);
        await api("resumes", { method: "POST", body: form });
      }
      await refreshAccount();
      setUploadOpen(false);
      setView("resumes");
      toast.success(
        editingId
          ? "Profile details updated."
          : "Resume saved to your library.",
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function makePrimary(id: string) {
    try {
      await api("resumes/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary: true }),
      });
      await refreshAccount();
      toast.success("Primary resume updated.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function download(p: ResumeProfile, format: "pdf" | "docx" | "tex") {
    try {
      await exportResume(p, format, (p.name || "ApplyDesk") + "-resume");
      toast.success(format.toUpperCase() + " downloaded.");
    } catch (error: any) {
      toast.error(
        error.message || "The download could not be created. Please try again.",
      );
    }
  }
  async function saveResumePreference(source: ResumeSource) {
    setPreferenceBusy(true);
    try {
      await api("preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeSource: source }),
      });
      await refreshAccount();
      setTailored(null);
      toast.success(
        source === "custom"
          ? "Future applications will use your custom original."
          : "Future applications will use your ApplyDesk resume.",
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPreferenceBusy(false);
    }
  }
  function resumePreference() {
    return (
      <div className="resume-preference">
        <h3>Resume for new applications</h3>
        <Picker
          value={resumeSource}
          disabled={preferenceBusy || busy}
          onChange={(value) => void saveResumePreference(value as ResumeSource)}
          label="Default application resume"
          options={[
            ["applydesk", "ApplyDesk resume (default)"],
            ["custom", "Use my custom original"],
          ]}
        />
        <p className="estimate-note">
          {resumeSource === "applydesk"
            ? "Use your reviewed ApplyDesk format and any changes you prepare for the job."
            : "Use the selected uploaded file exactly as it is, without ApplyDesk formatting or tailoring."}{" "}
          Saved for future applications. Past applications keep their saved
          version.
        </p>
      </div>
    );
  }
  async function downloadSavedApplication(application: Activity) {
    if (!application.applicationId) return;
    try {
      await downloadApplicationResume(application.applicationId);
      toast.success(
        "Saved application resume downloaded. Upload it on the employer’s website.",
      );
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function applyNow() {
    if (!job || !applyingResume || preferenceBusy) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    setBusy(true);
    try {
      const result = await act(
        job,
        "application",
        "Started",
        resumeSource === "applydesk"
          ? tailored || applyingResume.profile
          : applyingResume.profile,
      );
      if (result?.url) {
        if (tab) tab.location.href = result.url;
        else window.location.assign(result.url);
        toast.success(
          result.already
            ? "Existing application reopened. Its saved resume and status are unchanged."
            : "Application prepared. Download the saved resume and upload it on the employer’s website.",
        );
        setHandoffJobId(job.id);
        setJob(null);
        setView("applications");
      } else tab?.close();
    } finally {
      setBusy(false);
    }
  }
  function resetFilters() {
    setQuery("");
    setDays("30");
    setEmployment("all");
    setState("all");
    setMode("all");
    setJobTab("all");
  }
  // The browser tool searches the same visible feed and changes only the search field.
  useEffect(() => {
    const ctx = (document as any).modelContext;
    if (!ctx?.registerTool) return;
    const life = new AbortController();
    try {
      Promise.resolve(
        ctx.registerTool(
          {
            name: "search_applydesk_jobs",
            title: "Search ApplyDesk jobs",
            description:
              "Search the visible employer job feed and open Find jobs. Does not save or apply.",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string", maxLength: 120 } },
              required: ["query"],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            execute(input: any) {
              if (
                !input ||
                typeof input.query !== "string" ||
                input.query.length > 120 ||
                Object.keys(input).some((k) => k !== "query")
              )
                throw new Error(
                  "Provide one query string of at most 120 characters.",
                );
              setQuery(input.query);
              setView("jobs");
              setJobTab("all");
              return { query: input.query, view: "Find jobs" };
            },
          },
          { signal: life.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => life.abort();
  }, []);
  return (
    <SidebarProvider>
      <Toaster richColors position="bottom-right" />
      <Sidebar className="desk-sidebar">
        <SidebarHeader>
          <a href="copilot.html" className="brand">
            <span className="brand-icon">
              <Plane size={23} />
            </span>
            apply<span>desk</span>.
          </a>
        </SidebarHeader>
        <SidebarContent>
          <p className="nav-label">SELF-SERVICE WORKSPACE</p>
          <SidebarMenu>
            {nav.map(({ id, icon: Icon, label }) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton
                  className="nav-button"
                  isActive={view === id}
                  onClick={() => setView(id)}
                >
                  <Icon />
                  <span>{label}</span>
                  {id === "saved" &&
                    !!account?.activity.filter((a) => a.action === "saved")
                      .length && (
                      <small className="nav-count">
                        {
                          account.activity.filter((a) => a.action === "saved")
                            .length
                        }
                      </small>
                    )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-note">
            <ShieldCheck />
            <strong>
              Your next chapter.
              <br />
              Without the guesswork.
            </strong>
            <p>
              Opportunities with sponsorship language, straight from employers.
            </p>
            <small>BUILT FOR YOUR AMBITION ↗</small>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <button
            className="account"
            onClick={() => (account ? setView("resumes") : setLogin(true))}
          >
            <span className="avatar">
              {account?.user.displayName[0]?.toUpperCase() || "A"}
            </span>
            <div>
              <strong>{account?.user.displayName || "Your workspace"}</strong>
              <p>
                {account
                  ? "Your career, in motion"
                  : "Sign in to make it yours"}
              </p>
            </div>
            <ChevronRight size={15} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>Self-service</span>
            <span>/</span>
            <strong>{nav.find((n) => n.id === view)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className="us-label">
              United States <b>US</b>
            </span>
            {account ? (
              <button
                onClick={() => void sb.auth.signOut({ scope: "local" })}
                className="text-link"
              >
                Sign out
              </button>
            ) : (
              <button className="text-link" onClick={() => setLogin(true)}>
                Sign in <LogIn size={14} />
              </button>
            )}
          </div>
        </header>
        <main className="main-content">
          {accountError && (
            <div className="notice error">
              <Info size={18} />
              <span>{accountError}</span>
              <button onClick={() => void refreshAccount()}>Retry</button>
            </div>
          )}
          {(view === "jobs" || view === "saved") && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">A NEW CHAPTER STARTS HERE</p>
                  <h1>
                    {view === "saved"
                      ? "Good opportunities, kept close"
                      : "Find your next opportunity"}
                    <span>.</span>
                  </h1>
                  <p>
                    {view === "saved"
                      ? "Your shortlist for what comes next."
                      : "Fresh roles. Clear sponsorship. A better fit for you."}
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setView("resumes")}
                >
                  <FileText size={17} />
                  My resumes
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <section className="profile-banner">
                <span className="banner-icon">
                  <Sparkles />
                </span>
                <div>
                  <strong>
                    {primary
                      ? "Your resume is ready. Find where you fit."
                      : "A great match starts with your resume"}
                  </strong>
                  <p>
                    {primary ? (
                      <>
                        <b>{primary.name}</b> · Primary resume ·{" "}
                        {resumeQuality(primary.profile)}/10 readiness estimate
                      </>
                    ) : (
                      "Upload your resume to discover your fit and plan your next move."
                    )}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => (primary ? setView("resumes") : openUpload())}
                >
                  {primary ? <FileText size={17} /> : <Plus size={17} />}{" "}
                  {primary ? "View resume" : "Upload resume"}
                </button>
              </section>
              <form
                className="search-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  searchRef.current?.blur();
                }}
              >
                <div className="search-input">
                  <Search size={20} />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search jobs"
                    placeholder="Job title, skill, or company"
                  />
                  <kbd>⌘ K</kbd>
                </div>
                <button className="button primary" type="submit">
                  Search jobs
                  <ArrowUpRight size={17} />
                </button>
              </form>
              <div className="filter-row">
                <Picker
                  label="Date posted"
                  value={days}
                  onChange={setDays}
                  options={[
                    ["30", "Past 30 days"],
                    ["7", "Past week"],
                    ["1", "Past 24 hours (1 day)"],
                  ]}
                />
                <Picker
                  label="Employment type"
                  value={employment}
                  onChange={setEmployment}
                  options={[
                    ["all", "Employment type"],
                    ["Full-time", "Full-time"],
                    ["W2 contract", "W2 contract"],
                    ["Corp-to-corp", "Corp-to-corp"],
                    ["Contract", "Contract"],
                    ["Part-time", "Part-time"],
                    ["Internship", "Internship"],
                  ]}
                />
                <Picker
                  label="Location"
                  value={state}
                  onChange={setState}
                  options={[
                    ["all", "All US states"],
                    ...STATES.map((s) => [s, s] as [string, string]),
                  ]}
                />
                <Picker
                  label="Work arrangement"
                  value={mode}
                  onChange={setMode}
                  options={[
                    ["all", "Work arrangement"],
                    ["Remote", "Remote"],
                    ["Hybrid", "Hybrid"],
                    ["On-site", "On-site"],
                  ]}
                />
                <span className="sponsor-chip">
                  <ShieldCheck size={15} />
                  {scope === "h1b"
                    ? "H-1B explicitly stated"
                    : "Visa sponsorship stated"}
                </span>
              </div>
              <div className="feed-line">
                <button onClick={() => setSourcesOpen(true)}>
                  <span
                    className={
                      "status-dot " +
                      (feedError ||
                      (feed &&
                        feed.sources.length > 0 &&
                        !feed.sources.some((source) => source.ok))
                        ? "offline"
                        : !feed || !feed.sources.length
                          ? "pending"
                          : "")
                    }
                  />
                  {feed && !feed.sources.length
                    ? "Waiting for the first employer sync"
                    : feed
                      ? `${feed.sources.filter((s) => s.ok).length} of ${feed.sources.length} employer boards current`
                      : "Connecting employer boards"}
                  <Info size={13} />
                </button>
                <span>
                  {feed?.fetchedAt
                    ? `Last source check ${since(feed.fetchedAt)}`
                    : "Current employer listings only"}
                </span>
                <button
                  aria-label="Refresh jobs"
                  onClick={() => void loadJobs()}
                  disabled={loading}
                >
                  <RefreshCw size={14} className={loading ? "spin" : ""} />
                </button>
              </div>
              <div className="results-heading">
                <div className="result-tabs">
                  <Tabs value={jobTab} onValueChange={setJobTab}>
                    <TabsList className="job-tabs">
                      <TabsTrigger value="all">
                        {view === "saved" ? "Saved jobs" : "All jobs"}
                        <span>{filtered.length}</span>
                      </TabsTrigger>
                      {view === "jobs" && (
                        <>
                          <TabsTrigger value="matches">For you</TabsTrigger>
                          <TabsTrigger value="skipped">Skipped</TabsTrigger>
                        </>
                      )}
                    </TabsList>
                  </Tabs>
                </div>
                <Picker
                  value={sort}
                  onChange={setSort}
                  label="Sort jobs"
                  options={[
                    ["newest", "Newest first"],
                    ["match", "Best match"],
                  ]}
                />
              </div>
              <div className="scope-row">
                <span className="strict-label">
                  <ShieldCheck size={14} />
                  H-1B explicitly stated in every listing
                </span>
                <span>
                  {view === "jobs" && jobTab !== "skipped" && feed?.jobs.length
                    ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"} from ${feed.jobs.length} current H-1B ${feed.jobs.length === 1 ? "listing" : "listings"}`
                    : "Current roles from connected employer boards."}
                </span>
              </div>
              {feedError ? (
                <Blank
                  title="The job feed is taking a moment"
                  action={
                    <button
                      className="button secondary"
                      onClick={() => void loadJobs()}
                    >
                      Try again
                    </button>
                  }
                >
                  {feedError}
                </Blank>
              ) : loading && !feed ? (
                <div className="feed-loading">
                  <LoaderCircle className="spin" />
                  <p>Checking employer career pages…</p>
                </div>
              ) : view === "jobs" &&
                jobTab !== "skipped" &&
                feedState !== "ready" ? (
                <Blank
                  title={
                    feedState === "awaiting_sources"
                      ? "The job feed is waiting for its first sync"
                      : feedState === "unavailable"
                        ? "Employer boards need a fresh check"
                        : "No current roles meet the H-1B requirements"
                  }
                  action={
                    <button
                      className="button secondary"
                      disabled={loading}
                      onClick={() => void loadJobs()}
                    >
                      Check again
                    </button>
                  }
                >
                  {feedState === "awaiting_sources"
                    ? "Your resume is saved. Employer listings have not synced yet, so search and matching have no jobs to use. The ApplyDesk team needs to finish connecting the feed."
                    : feedState === "unavailable"
                      ? "The latest source checks are unavailable or out of date. No eligible current listings can be shown yet. Matching will resume when fresh listings are available."
                      : "The latest source checks found no eligible US listings with an explicit H-1B sponsorship statement and a publication date in the past 30 days. Your resume is ready for the next update."}
                </Blank>
              ) : filtered.length ? (
                <div className="job-grid">
                  {filtered.map((j) => {
                    const m = matchProfile(primary?.profile || null, j),
                      a = actions.get(j.id);
                    return (
                      <article
                        className="job-card"
                        key={j.id}
                        style={
                          { "--match": `${m.score || 0}%` } as CSSProperties
                        }
                      >
                        <div className="card-fill" />
                        <div className="card-top">
                          <span
                            className={
                              "company-logo logo-" +
                              (j.company.charCodeAt(0) % 4)
                            }
                          >
                            {j.company === "Thinking Machines"
                              ? "tm"
                              : j.company === "Nuance Labs"
                                ? "n."
                                : j.company === "Wispr Flow"
                                  ? "w"
                                  : j.company === "Anthropic"
                                    ? "A"
                                    : j.company[0]}
                          </span>
                          <div>
                            <strong>{j.company}</strong>
                            <span>
                              {j.dateLabel} {since(j.publishedAt)}
                            </span>
                          </div>
                          <button
                            className={
                              "save-button " +
                              (a?.action === "saved" ? "saved" : "")
                            }
                            aria-label={
                              a?.action === "saved"
                                ? `Unsave ${j.title}`
                                : `Save ${j.title}`
                            }
                            onClick={() =>
                              void act(
                                j,
                                a?.action === "saved" ? "remove" : "saved",
                              ).then(
                                (r) =>
                                  r &&
                                  toast.success(
                                    a?.action === "saved"
                                      ? "Removed from saved jobs."
                                      : "Job saved.",
                                  ),
                              )
                            }
                            disabled={a?.action === "application"}
                          >
                            <Bookmark
                              size={19}
                              fill={
                                a?.action === "saved" ? "currentColor" : "none"
                              }
                            />
                          </button>
                        </div>
                        <button
                          className="card-title"
                          onClick={() => openJob(j)}
                        >
                          {j.title}
                        </button>
                        <span className="sponsorship-tag">
                          <ShieldCheck size={13} />
                          {sponsorshipLabel(j)}
                          {j.status !== "active"
                            ? " · " + (j.status || "stale")
                            : ""}
                        </span>
                        <div className="job-facts">
                          <span>
                            <MapPin />
                            {j.location}
                          </span>
                          <span>
                            <Building2 />
                            {j.workMode} · {j.employment}
                          </span>
                          <span>
                            <BriefcaseBusiness />
                            {j.experience || "Experience not specified"}
                          </span>
                        </div>
                        <div className="salary">
                          {j.salary || "Salary not disclosed"}
                          {j.salary && (
                            <small>Employer-listed compensation</small>
                          )}
                        </div>
                        <div className="skill-tags">
                          {j.skills.slice(0, 3).map((s) => (
                            <span key={s}>{s}</span>
                          ))}
                          {j.skills.length > 3 && (
                            <span>+{j.skills.length - 3}</span>
                          )}
                        </div>
                        <div className="card-match">
                          <span>
                            <Sparkles size={14} />
                            {m.score === null
                              ? "Discover your match"
                              : m.score >= 85
                                ? "Strong match"
                                : m.score >= 60
                                  ? "Potential match"
                                  : "Room to grow"}
                          </span>
                          <strong>
                            {m.score === null ? "—" : `${m.score}%`}
                          </strong>
                        </div>
                        <div className="card-actions">
                          <button
                            className="card-apply"
                            onClick={() => openJob(j)}
                          >
                            {a?.action === "application"
                              ? "View job"
                              : "Apply now"}
                            <ArrowUpRight size={16} />
                          </button>
                          <button
                            className="skip-button"
                            aria-label={
                              a?.action === "skipped"
                                ? `Restore ${j.title}`
                                : `Skip ${j.title}`
                            }
                            onClick={() =>
                              void act(
                                j,
                                a?.action === "skipped" ? "remove" : "skipped",
                              ).then(
                                (r) =>
                                  r &&
                                  toast.success(
                                    a?.action === "skipped"
                                      ? "Job restored."
                                      : "Job moved to Skipped.",
                                  ),
                              )
                            }
                            disabled={a?.action === "application"}
                          >
                            {a?.action === "skipped" ? (
                              <RefreshCw size={16} />
                            ) : (
                              <X size={16} />
                            )}
                          </button>
                        </div>
                        <p className="applicant-count">
                          Applicant count not published
                        </p>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Blank
                  icon={view === "saved" ? Bookmark : Search}
                  title={
                    view === "saved"
                      ? "Your shortlist is waiting"
                      : jobTab === "matches" && !primary
                        ? "Add a resume to find your fit"
                        : jobTab === "matches"
                          ? "No close resume matches yet"
                          : "No roles match these filters"
                  }
                  action={
                    <div className="button-row">
                      {jobTab === "matches" && !primary ? (
                        <button
                          className="button primary"
                          onClick={() => openUpload()}
                        >
                          Upload resume
                        </button>
                      ) : (
                        <button
                          className="button secondary"
                          onClick={resetFilters}
                        >
                          Reset filters
                        </button>
                      )}
                      {view === "saved" && (
                        <button
                          className="button primary"
                          onClick={() => setView("jobs")}
                        >
                          Explore jobs <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                  }
                >
                  {view === "saved"
                    ? "Save a role using the bookmark on its card. Try clearing filters if your saved roles are hidden."
                    : jobTab === "matches"
                      ? "For you shows roles with at least 60% of detected job skills in your primary resume. Explore All jobs for other eligible roles, or review your profile details."
                      : "Try a different title, state, or date range. Only eligible jobs from the connected employer boards appear here."}
                </Blank>
              )}
              <footer className="page-footer">
                <ShieldCheck size={15} />
                Employer-sourced listings. Coverage is limited to connected
                boards; sponsorship depends on the role and candidate.
              </footer>
            </>
          )}
          {view === "resumes" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">PUT YOUR BEST WORK FORWARD</p>
                  <h1>
                    One profile. Every possibility<span>.</span>
                  </h1>
                  <p>
                    Keep your experience current and your next application
                    ready.
                  </p>
                </div>
                <button className="button primary" onClick={() => openUpload()}>
                  <Plus size={17} />
                  Add resume
                </button>
              </div>
              {!account ? (
                <Blank
                  icon={FileText}
                  title="A home for your experience"
                  action={
                    <button
                      className="button primary"
                      onClick={() => setLogin(true)}
                    >
                      Sign in to upload
                    </button>
                  }
                >
                  Save your PDF or Word resume, review your profile, and choose
                  a primary version.
                </Blank>
              ) : !account.resumes.length ? (
                <div className="upload-welcome">
                  <div>
                    <span className="empty-icon">
                      <FileText size={35} />
                    </span>
                    <h2>Your next chapter starts here</h2>
                    <p>
                      Add a resume and we’ll organize your experience, skills,
                      and education into a profile you can review.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => openUpload()}
                    >
                      <Upload size={17} />
                      Upload your resume
                    </button>
                    <small>
                      PDF or Word (.docx) · Up to 5 MB · Your original stays
                      available
                    </small>
                  </div>
                  <div className="resume-outline">
                    <span>YOUR NAME</span>
                    <i />
                    <i />
                    <b>EXPERIENCE</b>
                    <i />
                    <i />
                    <i />
                    <b>SKILLS</b>
                    <i />
                    <b>EDUCATION</b>
                    <i />
                  </div>
                </div>
              ) : (
                <>
                  <div className="resume-library">
                    {account.resumes.map((r) => (
                      <button
                        key={r.id}
                        className={
                          "resume-tile " +
                          (activeResume?.id === r.id ? "selected" : "")
                        }
                        onClick={() => setSelectedResume(r.id)}
                      >
                        <span className="file-icon">
                          <FileText size={22} />
                        </span>
                        <span>
                          <strong>{r.name}</strong>
                          <small>
                            {new Date(r.createdAt).toLocaleDateString()} ·{" "}
                            {r.type === "application/pdf" ? "PDF" : "Word"}
                          </small>
                        </span>
                        {r.primary && (
                          <span className="primary-badge">
                            <Star size={11} />
                            Primary
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {activeResume && (
                    <div className="resume-layout">
                      <aside className="resume-sidebar">
                        <Meter score={resumeQuality(activeResume.profile)} />
                        <p className="estimate-note">
                          A formatting and completeness checklist, not an
                          employer’s ATS score.
                        </p>
                        <div className="divider" />
                        {resumePreference()}
                        <div className="divider" />
                        <h3>Make this version yours</h3>
                        <button
                          className="button secondary full"
                          onClick={() => {
                            setDraft({ ...activeResume.profile });
                            setEditingId(activeResume.id);
                            setFile(null);
                            setUploadOpen(true);
                          }}
                        >
                          <FileText size={16} />
                          Review profile details
                        </button>
                        {!activeResume.primary && (
                          <button
                            className="button secondary full"
                            onClick={() => void makePrimary(activeResume.id)}
                          >
                            <Star size={16} />
                            Make primary
                          </button>
                        )}
                        <button
                          className="button secondary full"
                          onClick={() => openUpload(activeResume.id)}
                        >
                          <RefreshCw size={16} />
                          Replace original file
                        </button>
                        <button
                          className="button secondary full"
                          onClick={() =>
                            void openOriginal(activeResume.id).catch((e) =>
                              toast.error(e.message),
                            )
                          }
                        >
                          <ExternalLink size={16} />
                          View uploaded original
                        </button>
                        <div className="divider" />
                        <h3>Download formatted resume</h3>
                        <div className="export-buttons">
                          {(["pdf", "docx", "tex"] as const).map((f) => (
                            <button
                              key={f}
                              className="button secondary"
                              onClick={() =>
                                void download(activeResume.profile, f)
                              }
                            >
                              <Download size={13} />
                              {f.toUpperCase()}
                            </button>
                          ))}
                        </div>
                        <p className="estimate-note">
                          Times typography and the section order from your
                          supplied LaTeX format. Review extracted details before
                          applying.
                        </p>
                        <div className="tip">
                          <ShieldCheck size={18} />
                          <p>
                            Your uploaded original stays separate from your
                            editable profile and application versions.
                          </p>
                        </div>
                      </aside>
                      <ResumePaper profile={activeResume.profile} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {view === "applications" && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">EVERY STEP, IN ONE PLACE</p>
                  <h1>
                    Keep your next move in view<span>.</span>
                  </h1>
                  <p>
                    Track progress and the resume used for every application.
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setView("jobs")}
                >
                  Find more jobs
                  <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="application-stats">
                {["Started", "Applied", "Interview", "Offer"].map((s) => (
                  <div key={s}>
                    <span>{s}</span>
                    <strong>
                      {account?.activity.filter(
                        (a) => a.action === "application" && a.status === s,
                      ).length || 0}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="notice">
                <Info size={17} />
                Opening a career page marks an application as Started. Update it
                to Applied after you submit on the employer’s site.
              </p>
              {handoffApplication && (
                <div className="application-handoff" role="status">
                  <FileText size={24} />
                  <div>
                    <strong>
                      Your resume for {handoffApplication.job.title} is ready
                    </strong>
                    <p>
                      {resumeSourceLabel(
                        handoffApplication.resumeSource || "applydesk",
                      )}{" "}
                      saved for this application. Download it and upload it on
                      the employer’s website. ApplyDesk does not attach files to
                      that site automatically.
                    </p>
                  </div>
                  <button
                    className="button primary"
                    onClick={() =>
                      void downloadSavedApplication(handoffApplication)
                    }
                  >
                    <Download size={16} />
                    Download saved resume
                  </button>
                </div>
              )}
              {account?.activity.some((a) => a.action === "application") ? (
                <div className="application-list">
                  {account.activity
                    .filter((a) => a.action === "application")
                    .map((a) => (
                      <div className="application-row" key={a.jobId}>
                        <span className="company-logo">{a.job.company[0]}</span>
                        <div className="application-info">
                          <strong>{a.job.title}</strong>
                          <span>
                            {a.job.company} · {a.job.location}
                          </span>
                          <small>
                            Updated {since(a.updatedAt)} ·{" "}
                            {resumeSourceLabel(a.resumeSource || "applydesk")} ·{" "}
                            {a.resumeFileName || "Application resume snapshot"}
                          </small>
                        </div>
                        <Picker
                          label={"Status for " + a.job.title}
                          value={a.status}
                          onChange={(s) => {
                            void api("activity", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                jobId: a.jobId,
                                action: "application",
                                status: s,
                                resumeId: a.resumeId,
                              }),
                            })
                              .then(() => refreshAccount())
                              .catch((e) => toast.error(e.message));
                          }}
                          options={statuses.map((s) => [s, s])}
                        />
                        {a.applicationId && (
                          <button
                            className="icon-button"
                            aria-label="Download application resume"
                            onClick={() => void downloadSavedApplication(a)}
                          >
                            <Download size={17} />
                          </button>
                        )}
                        <a
                          className="icon-button"
                          href={a.job.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open employer application"
                        >
                          <ArrowUpRight size={18} />
                        </a>
                      </div>
                    ))}
                </div>
              ) : (
                <Blank
                  icon={BriefcaseBusiness}
                  title="Your first application is a fresh start"
                  action={
                    <button
                      className="button primary"
                      onClick={() => setView("jobs")}
                    >
                      Find your next role <ArrowRight size={16} />
                    </button>
                  }
                >
                  Start from a job card. Your selected resume and application
                  status will be saved here.
                </Blank>
              )}
            </>
          )}
        </main>
      </SidebarInset>
      <Dialog open={login} onOpenChange={setLogin}>
        <DialogContent className="login-dialog">
          <DialogHeader>
            <span className="login-icon">
              <Plane size={28} />
            </span>
            <DialogTitle>Make room for your next chapter.</DialogTitle>
            <DialogDescription>
              Sign in with your self-service account to keep your resumes and
              applications in your own workspace.
            </DialogDescription>
          </DialogHeader>
          <a className="button primary full" href="copilot.html">
            Continue to sign in <ArrowRight size={17} />
          </a>
          <p className="estimate-note">
            Your self-service account is separate from recruiter-managed clients
            and their applications.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={sourcesOpen} onOpenChange={setSourcesOpen}>
        <DialogContent className="source-dialog">
          <DialogHeader>
            <DialogTitle>Direct from the source</DialogTitle>
            <DialogDescription>
              Current listings from your connected employer boards. This is a
              curated feed, not every US job opening.
            </DialogDescription>
          </DialogHeader>
          <div className="source-list">
            {feed && !feed.sources.length && (
              <p>No employer sources have completed their first sync yet.</p>
            )}
            {feed?.sources.map((s) => (
              <div key={s.name}>
                <span className={"status-dot " + (s.ok ? "" : "offline")} />
                <strong>{s.name}</strong>
                <span>
                  {s.ok
                    ? `${s.count} eligible recent roles`
                    : "Temporarily unavailable"}
                </span>
              </div>
            ))}
          </div>
          <div className="tip">
            <Info size={18} />
            <p>
              H-1B badges require an explicit positive statement in the job
              description. Generic visa support or historical sponsorship alone
              does not qualify a listing.
            </p>
          </div>
          <p className="estimate-note">
            Greenhouse dates reflect first publication. Ashby dates reflect last
            publication. Applicant counts are not available from these feeds.
            The scheduled feed checks every 15 minutes when configured. The
            timestamp above shows the last successful check; availability can
            change.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={uploadOpen}
        onOpenChange={(v) => {
          if (!busy) setUploadOpen(v);
        }}
      >
        <DialogContent className="upload-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingId
                ? "Review your profile"
                : replaceId
                  ? "Replace this resume"
                  : "Add your resume"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Correct extracted details before using them in applications. Your uploaded original is preserved."
                : replaceId
                  ? "Review a new file before replacing the original. Past application snapshots will remain available."
                  : "Upload a PDF or Word (.docx) file, then review the details we extract."}
            </DialogDescription>
          </DialogHeader>
          {!editingId && (
            <>
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                ref={uploadRef}
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files?.[0]) void parseFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <button
                className="dropzone"
                disabled={busy}
                onClick={() => uploadRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && e.dataTransfer.files[0])
                    void parseFile(e.dataTransfer.files[0]);
                }}
              >
                {busy ? <LoaderCircle className="spin" /> : <Upload />}
                <strong>
                  {file ? file.name : "Choose a file or drop it here"}
                </strong>
                <span>PDF or Word (.docx) · Maximum 5 MB</span>
              </button>
            </>
          )}
          {(file || editingId) && (
            <>
              <div className="notice">
                <Info size={16} />
                Check every section. Automatic extraction can miss or misplace
                details.
              </div>
              <div className="profile-fields">
                {Object.entries(profileLabels).map(([key, label]) => (
                  <label
                    key={key}
                    className={
                      sections.includes(key as keyof ResumeProfile)
                        ? "wide"
                        : ""
                    }
                  >
                    {label}
                    {sections.includes(key as keyof ResumeProfile) ? (
                      <textarea
                        aria-label={label}
                        value={draft[key as keyof ResumeProfile]}
                        rows={key === "experience" ? 6 : 3}
                        onChange={(e) =>
                          setDraft({ ...draft, [key]: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        aria-label={label}
                        value={draft[key as keyof ResumeProfile]}
                        onChange={(e) =>
                          setDraft({ ...draft, [key]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setUploadOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void saveResume()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  Save reviewed profile
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!job}
        onOpenChange={(v) => {
          if (!v) setJob(null);
        }}
      >
        <DialogContent
          className={
            "job-dialog " + (jobStage === "tailor" ? "tailor-dialog" : "")
          }
        >
          <DialogHeader>
            <div className="modal-eyebrow">
              {job?.company} <span>APPLICATION PREVIEW</span>
            </div>
            <DialogTitle>{job?.title}</DialogTitle>
            <DialogDescription>
              {job?.location} · {job?.employment} · {job?.workMode}
            </DialogDescription>
          </DialogHeader>
          {job && (
            <>
              {jobStage === "review" ? (
                <>
                  <div className="job-review-grid">
                    <div className="job-description">
                      <div className="evidence-box">
                        <ShieldCheck size={19} />
                        <div>
                          <strong>{sponsorshipLabel(job)}</strong>
                          <blockquote>“{job.evidence}”</blockquote>
                          <p>
                            Employer statement; individual eligibility is not
                            guaranteed.
                          </p>
                        </div>
                      </div>
                      {job.status !== "active" && (
                        <div className="notice">
                          This saved role is {job.status || "unverified"}. It
                          cannot start a new application until its source is
                          verified again.
                        </div>
                      )}
                      {actions.get(job.id)?.action === "application" && (
                        <div className="notice">
                          You already have an application for this job.
                          Continuing reopens the employer page and keeps your
                          original saved application resume and status.
                        </div>
                      )}
                      <div className="detail-facts">
                        <span>{job.salary || "Salary not disclosed"}</span>
                        <span>
                          {job.experience || "Experience not specified"}
                        </span>
                        <span>
                          {job.dateLabel}{" "}
                          {new Date(job.publishedAt).toLocaleDateString()}
                        </span>
                        <span>Applicant count not published</span>
                      </div>
                      <h3>About this opportunity</h3>
                      <p className="description-text">{job.description}</p>
                      <a
                        className="text-link"
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read on the employer’s site <ExternalLink size={14} />
                      </a>
                    </div>
                    <aside className="match-panel">
                      {applyingResume ? (
                        <>
                          <Picker
                            value={applyingResume.id}
                            onChange={(v) => {
                              setChosenResume(v);
                              setTailored(null);
                            }}
                            disabled={
                              !!existingApplication || busy || preferenceBusy
                            }
                            label="Resume for application"
                            options={account!.resumes.map((r) => [
                              r.id,
                              r.name + (r.primary ? " · Primary" : ""),
                            ])}
                          />
                          {existingApplication ? (
                            <p className="notice">
                              Saved for this application:{" "}
                              {resumeSourceLabel(
                                existingApplication.resumeSource || "applydesk",
                              )}
                              . Reopening keeps its original snapshot.
                            </p>
                          ) : (
                            resumePreference()
                          )}
                          {match.score === null ? (
                            <p className="notice">
                              A match score is unavailable because this
                              description has no recognized skill terms.
                            </p>
                          ) : (
                            <Meter
                              score={match.score / 10}
                              label="Estimated job keyword match"
                            />
                          )}
                          <p className="estimate-note">
                            {match.matched.length} of {job.skills.length}{" "}
                            detected skills found. Estimated ATS keyword
                            coverage; employer systems may score differently.
                            {resumeSource === "custom" &&
                              " This estimate uses your reviewed profile; your unchanged custom file may contain different text."}
                          </p>
                          <h3>
                            {match.score !== null && match.score >= 85
                              ? "You’re in a strong position"
                              : "Bring your relevant skills forward"}
                          </h3>
                          <div className="skill-tags">
                            {match.matched.map((s) => (
                              <span className="matched" key={s}>
                                <Check size={11} />
                                {s}
                              </span>
                            ))}
                          </div>
                          {match.missing.length > 0 && (
                            <>
                              <p className="small-label">
                                NOT FOUND IN YOUR RESUME
                              </p>
                              <div className="skill-tags">
                                {match.missing.map((s) => (
                                  <span key={s}>{s}</span>
                                ))}
                              </div>
                            </>
                          )}
                          <button
                            className="button secondary full"
                            onClick={() => setJobStage("tailor")}
                            disabled={
                              resumeSource === "custom" ||
                              !!existingApplication ||
                              preferenceBusy
                            }
                          >
                            <Sparkles size={16} />
                            {match.score !== null && match.score >= 85
                              ? "Review resume"
                              : "Fix my resume"}
                          </button>
                          <p className="estimate-note">
                            {resumeSource === "custom"
                              ? "Your custom original is used unchanged. Choose ApplyDesk resume to use formatting and job-specific updates."
                              : "We keep your roles and experience intact. Add a missing skill only if you actually have it."}
                          </p>
                          <button
                            className="button primary full"
                            onClick={() => void applyNow()}
                            disabled={
                              busy ||
                              preferenceBusy ||
                              (job.status !== "active" &&
                                actions.get(job.id)?.action !== "application")
                            }
                          >
                            Apply now <ArrowUpRight size={16} />
                          </button>
                          <small>
                            Opens the employer’s site. Download your saved
                            resume, then upload it there.
                          </small>
                        </>
                      ) : (
                        <>
                          <FileText size={35} />
                          <h3>See how you match</h3>
                          <p>
                            Upload a resume to review your fit and prepare your
                            application.
                          </p>
                          <button
                            className="button primary full"
                            onClick={() => {
                              setJob(null);
                              openUpload();
                            }}
                          >
                            Upload resume <Plus size={16} />
                          </button>
                        </>
                      )}
                    </aside>
                  </div>
                </>
              ) : (
                <>
                  <div className="tailor-layout">
                    <aside className="tailor-controls">
                      <button
                        className="text-link"
                        onClick={() => setJobStage("review")}
                      >
                        ← Back to opportunity
                      </button>
                      {match.score === null ? (
                        <p className="notice">
                          Match score unavailable for this description.
                        </p>
                      ) : (
                        <Meter
                          score={(afterMatch?.score ?? match.score) / 10}
                          label="Estimated job keyword match"
                        />
                      )}
                      {tailored && match.score !== null && (
                        <p className="before-score">
                          Before {((match.score || 0) / 10).toFixed(1)} → After{" "}
                          {((afterMatch?.score || 0) / 10).toFixed(1)}
                        </p>
                      )}
                      <p className="estimate-note">
                        Formatting changes alone may not change your score.
                        Matching is based on detected skills.
                      </p>
                      <h3>Choose your adjustment</h3>
                      <RadioGroup
                        value={level}
                        onValueChange={(v) => {
                          setLevel(v as any);
                          setTailored(null);
                        }}
                      >
                        <label className="radio-card">
                          <RadioGroupItem value="light" />
                          <span>
                            <strong>Light touch</strong>
                            <small>
                              Prioritize relevant skills. Keep your wording.
                            </small>
                          </span>
                        </label>
                        <label className="radio-card">
                          <RadioGroupItem value="substantial" />
                          <span>
                            <strong>More focus</strong>
                            <small>
                              Also prioritize relevant bullets within existing
                              experience blocks.
                            </small>
                          </span>
                        </label>
                      </RadioGroup>
                      {match.missing.length > 0 && (
                        <>
                          <h3>Skills you can confirm</h3>
                          <p className="estimate-note">
                            Select only skills you genuinely have. They will be
                            added to Skills, never fabricated as work
                            experience.
                          </p>
                          <div className="confirm-skills">
                            {match.missing.map((s) => (
                              <label key={s}>
                                <Checkbox
                                  checked={confirmed.includes(s)}
                                  onCheckedChange={(v) => {
                                    setConfirmed(
                                      v
                                        ? [...confirmed, s]
                                        : confirmed.filter((x) => x !== s),
                                    );
                                    setTailored(null);
                                  }}
                                />
                                {s}
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                      <button
                        className="button primary full"
                        onClick={() => {
                          if (applyingResume) {
                            setTailored(
                              tailorProfile(
                                applyingResume.profile,
                                job,
                                level,
                                confirmed,
                              ),
                            );
                            setPaperTab("updated");
                            toast.success(
                              "Resume prepared. Review it before applying.",
                            );
                          }
                        }}
                      >
                        <Sparkles size={16} />
                        Prepare updated resume
                      </button>
                    </aside>
                    <div className="tailor-preview">
                      <div className="preview-toolbar">
                        <Tabs value={paperTab} onValueChange={setPaperTab}>
                          <TabsList>
                            <TabsTrigger value="original">
                              Original profile
                            </TabsTrigger>
                            <TabsTrigger value="updated" disabled={!tailored}>
                              Updated profile
                            </TabsTrigger>
                          </TabsList>
                        </Tabs>
                        <span>Jake-style format</span>
                      </div>
                      {applyingResume && (
                        <ResumePaper
                          profile={
                            paperTab === "updated" && tailored
                              ? tailored
                              : applyingResume.profile
                          }
                        />
                      )}
                    </div>
                  </div>
                  <div className="tailor-footer">
                    <div>
                      <ShieldCheck size={16} />
                      Your job titles and employers stay intact.
                    </div>
                    <div className="button-row">
                      {(["pdf", "docx", "tex"] as const).map((f) => (
                        <button
                          key={f}
                          className="button secondary"
                          onClick={() =>
                            applyingResume &&
                            void download(tailored || applyingResume.profile, f)
                          }
                        >
                          <Download size={14} />
                          {f.toUpperCase()}
                        </button>
                      ))}
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() => void applyNow()}
                      >
                        Apply now <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {loading && !feed && (
        <div className="landing-loader" role="status" aria-live="polite">
          <div className="flight-stage">
            <PlaneLanding className="landing-plane" size={45} />
            <span className="runway" />
            <span className="destination">UNITED STATES</span>
            <span className="visa-stamp">
              H-1B
              <br />
              <small>YOUR NEXT CHAPTER</small>
            </span>
          </div>
          <p>Bringing your next opportunity closer.</p>
          <span>Checking current employer listings…</span>
        </div>
      )}
    </SidebarProvider>
  );
}
