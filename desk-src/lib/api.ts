import { sb, rpc, getMember, validEmployerUrl } from "./client";
import {
  extractSkills,
  applicationResumeSource,
  profileText,
  emptyProfile,
  STATES,
  ABBR,
  type Feed,
  type Job,
  type Account,
  type Resume,
  type ResumeProfile,
  type Activity,
} from "./model";
import { exportResume, resumeLatex } from "./resume-files";
let latest: Account | null = null;
let accountGeneration = 0;
export function resetAccountCache() {
  latest = null;
  accountGeneration++;
}
const TO_STATUS: Record<string, string> = {
  Started: "opened",
  Applied: "applied",
  Interview: "interview",
  Offer: "offer",
  Rejected: "rejected",
  Withdrawn: "withdrawn",
};
const FROM_STATUS: Record<string, string> = Object.fromEntries(
  Object.entries(TO_STATUS).map(([k, v]) => [v, k]),
);
export function mapJob(r: any): Job {
  const location = String(r.location || "Location not published");
  const states = STATES.filter(
    (s, i) =>
      new RegExp(`\\b${s}\\b`, "i").test(location) ||
      new RegExp(`(?:,|\\s)${ABBR[i]}\\b`).test(location),
  );
  const cities: Record<string, string> = {
    "san francisco": "California",
    "palo alto": "California",
    "mountain view": "California",
    "los angeles": "California",
    "san jose": "California",
    seattle: "Washington",
    bellevue: "Washington",
    "new york": "New York",
    austin: "Texas",
    boston: "Massachusetts",
    chicago: "Illinois",
    atlanta: "Georgia",
    denver: "Colorado",
    charlotte: "North Carolina",
    raleigh: "North Carolina",
    miami: "Florida",
  };
  Object.entries(cities).forEach(([city, state]) => {
    if (location.toLowerCase().includes(city) && !states.includes(state))
      states.push(state);
  });
  return {
    id: String(r.id),
    board: r.source_board || r.source || "",
    company: r.company || "",
    title: r.title || "",
    location,
    states,
    workMode:
      r.work_mode === "Onsite" ? "On-site" : r.work_mode || "Not specified",
    employment: r.employment_type || "Not specified",
    salary: r.salary_text || null,
    experience: r.years_required || null,
    description: r.description || "",
    skills: extractSkills(r.description || ""),
    url: validEmployerUrl(r.url) || "",
    publishedAt: r.posted_at,
    dateLabel: r.date_basis === "last_published" ? "Last published" : "Posted",
    checkedAt: r.last_verified_at || r.last_seen_at,
    sponsorship:
      r.sponsorship_status === "explicit_h1b"
        ? "h1b"
        : r.sponsorship_status === "visa_sponsorship"
          ? "visa"
          : r.sponsorship_status === "not_sponsored"
            ? "not_sponsored"
            : "unknown",
    status: r.status || "stale",
    evidence: r.sponsorship_evidence || "",
  };
}
export function mapFeed(data: any): Feed {
  const sources = (data.feed_status || []).map((s: any) => ({
    name: s.company || s.source_board,
    ok:
      s.status === "ok" &&
      Date.now() - Date.parse(s.last_success_at) < 24 * 3600000,
    count: s.jobs_eligible || 0,
    checkedAt: s.last_success_at || s.last_attempt_at,
    error: s.status !== "ok" ? "Temporarily unavailable" : undefined,
  }));
  return {
    jobs: (data.jobs || []).map(mapJob).filter((j: Job) => j.url),
    sources,
    fetchedAt:
      sources
        .map((s: any) => s.checkedAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] || "",
  };
}
function mapResume(r: any): Resume {
  return {
    id: String(r.id),
    name: r.file_name,
    type: /\.pdf$/i.test(r.file_name)
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    profile: { ...emptyProfile(), ...r.parsed_profile },
    primary: !!r.is_primary,
    createdAt: r.created_at,
  };
}
export async function api(path: string, options?: RequestInit): Promise<any> {
  const [route, id] = path.split("/");
  const method = options?.method || "GET";
  let body: any = {};
  if (typeof options?.body === "string") body = JSON.parse(options.body);
  if (route === "jobs") {
    return mapFeed(await rpc("fn_ss_discover_jobs", { p_limit: 1000 }));
  }
  if (route === "account") {
    const requestGeneration = accountGeneration;
    const [member, data] = await Promise.all([
      getMember(),
      rpc("fn_ss_get_my_workspace"),
    ]);
    if (
      requestGeneration !== accountGeneration ||
      !member ||
      member.kind !== "member" ||
      member.profile?.status !== "active"
    )
      throw Object.assign(
        new Error("Please sign in with your ApplyDesk Self-service account."),
        { signIn: true },
      );
    const applications = (data.applications || []).map((a: any) => ({
      jobId: String(a.job_id),
      action: "application" as const,
      status: FROM_STATUS[a.status] || "Started",
      job: mapJob(a.job_snapshot),
      resumeId: String(a.resume_id),
      resumeSnapshot: a.resume_snapshot?.parsed_profile || null,
      resumeSource: applicationResumeSource(a.resume_snapshot?.source),
      resumeFileName: a.resume_snapshot?.file_name || "Application resume",
      applicationId: String(a.id),
      updatedAt: a.updated_at,
    }));
    const appIds = new Set(applications.map((a: any) => a.jobId));
    const activity = (data.activity || [])
      .filter(
        (a: any) =>
          a.state !== "none" && a.job && !appIds.has(String(a.job_id)),
      )
      .map((a: any) => ({
        jobId: String(a.job_id),
        action: a.state,
        status: "",
        job: mapJob(a.job),
        resumeId: null,
        resumeSnapshot: null,
        updatedAt: a.updated_at,
      }));
    latest = {
      user: {
        userId: member.session.user.id,
        displayName:
          member.profile?.full_name ||
          member.session.user.email ||
          "Your workspace",
        email: member.session.user.email || "",
      },
      applicationResumeSource: applicationResumeSource(
        data.application_resume_source,
      ),
      resumes: (data.resumes || []).map(mapResume),
      activity: [...applications, ...activity],
    };
    return latest;
  }
  if (route === "preferences" && method === "PATCH") {
    if (!["applydesk", "custom"].includes(body.resumeSource))
      throw new Error("Choose an application resume source.");
    return rpc("fn_ss_set_resume_preference", { p_source: body.resumeSource });
  }
  if (route === "resumes" && method === "POST") {
    const form = options!.body as FormData;
    const file = form.get("file") as File;
    const { data } = await sb.auth.getUser();
    if (!data.user) throw new Error("Your session expired. Sign in again.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 150),
      storagePath = data.user.id + "/" + crypto.randomUUID() + "/" + safeName;
    const contentType = /\.pdf$/i.test(file.name)
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const { error } = await sb.storage
      .from("selfserve-resumes")
      .upload(storagePath, file, { contentType, upsert: false });
    if (error)
      throw new Error("Your resume could not be uploaded. " + error.message);
    const profile = JSON.parse(String(form.get("profile")));
    try {
      const saved = await rpc("fn_ss_save_my_resume", {
        p_file_name: file.name,
        p_storage_path: storagePath,
        p_resume_text: String(form.get("text")),
        p_parsed_profile: profile,
        p_latex_text: resumeLatex(profile),
        p_replace_id: form.get("replaceId")
          ? Number(form.get("replaceId"))
          : null,
      });
      return { ok: true, id: String(saved.resume?.id) };
    } catch (e) {
      throw e;
    }
  }
  if (route === "resumes" && id && method === "PATCH") {
    if (body.primary)
      return rpc("fn_ss_set_primary_resume", { p_resume_id: Number(id) });
    if (body.profile)
      return rpc("fn_ss_update_my_resume", {
        p_resume_id: Number(id),
        p_resume_text: profileText(body.profile),
        p_parsed_profile: body.profile,
        p_latex_text: resumeLatex(body.profile),
      });
  }
  if (route === "activity" && method === "POST") {
    if (body.action !== "application") {
      await rpc("fn_ss_set_job_activity", {
        p_job_id: Number(body.jobId),
        p_state: body.action === "remove" ? "none" : body.action,
      });
      return { ok: true };
    }
    const old = latest?.activity.find(
      (a) => a.jobId === body.jobId && a.action === "application",
    ) as (Activity & { applicationId: string }) | undefined;
    if (old) {
      if (!body.resumeSnapshot && body.status && TO_STATUS[body.status])
        await rpc("fn_ss_update_application_status", {
          p_application_id: Number(old.applicationId),
          p_status: TO_STATUS[body.status],
        });
      return { ok: true, already: true, url: validEmployerUrl(old.job.url) };
    }
    const resume = latest?.resumes.find((r) => r.id === body.resumeId);
    if (!resume) throw new Error("Select a saved resume first.");
    const profile: ResumeProfile = body.resumeSnapshot || resume.profile;
    const result = await rpc("fn_ss_log_application", {
      p_job_id: Number(body.jobId),
      p_resume_id: Number(body.resumeId),
      p_resume_text: profileText(profile),
      p_latex_text: resumeLatex(profile),
      p_score: body.score ?? null,
      p_status: TO_STATUS[body.status] || "opened",
      p_notes:
        "Prepared by the self-service member. Employer submission is completed on the employer site.",
      p_parsed_profile: profile,
      p_resume_source:
        body.resumeSource || latest?.applicationResumeSource || "applydesk",
    });
    const url = validEmployerUrl(result.url);
    if (!url)
      throw new Error(
        "Application saved, but the employer link is unavailable. Open your Applications to review it.",
      );
    return { ok: true, id: result.id, already: result.already, url };
  }
  throw new Error("This action is not available.");
}
export async function openOriginal(id: string) {
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  try {
    const data = await rpc("fn_ss_get_my_workspace");
    const resume = (data.resumes || []).find((r: any) => String(r.id) === id);
    if (!resume) throw new Error("This resume could not be found.");
    const { data: link, error } = await sb.storage
      .from("selfserve-resumes")
      .createSignedUrl(resume.storage_path, 120);
    if (error || !link?.signedUrl)
      throw new Error("The original file could not be opened.");
    if (tab) tab.location.href = link.signedUrl;
    else window.location.assign(link.signedUrl);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

// Resolve against the saved application, never today's preference or active library.
export async function downloadApplicationResume(applicationId: string) {
  const requestGeneration = accountGeneration;
  const checkAccount = () => {
    if (requestGeneration !== accountGeneration)
      throw new Error(
        "Your account changed. Open your current workspace and try again.",
      );
  };
  const data = await rpc("fn_ss_get_my_workspace");
  checkAccount();
  const application = (data.applications || []).find(
    (a: any) => String(a.id) === applicationId,
  );
  if (!application) throw new Error("This application could not be found.");
  const snapshot = application.resume_snapshot;
  if (applicationResumeSource(snapshot?.source) === "custom") {
    if (!snapshot?.storage_path)
      throw new Error("The saved original is unavailable.");
    const { data: link, error } = await sb.storage
      .from("selfserve-resumes")
      .createSignedUrl(snapshot.storage_path, 120, {
        download: snapshot.file_name || "resume",
      });
    checkAccount();
    if (error || !link?.signedUrl)
      throw new Error("The saved original could not be downloaded.");
    const a = document.createElement("a");
    a.href = link.signedUrl;
    a.download = snapshot.file_name || "resume";
    a.click();
    return;
  }
  if (!snapshot?.parsed_profile)
    throw new Error("The saved ApplyDesk resume is unavailable.");
  const profile = { ...emptyProfile(), ...snapshot.parsed_profile };
  await exportResume(
    profile,
    "pdf",
    (profile.name || "ApplyDesk") + "-application-resume",
  );
}
