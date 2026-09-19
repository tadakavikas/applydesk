export type ResumeProfile = {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  summary: string;
  experience: string;
  skills: string;
  certifications: string;
  education: string;
  projects: string;
  achievements: string;
};
export type Resume = {
  id: string;
  name: string;
  type: string;
  profile: ResumeProfile;
  primary: boolean;
  createdAt: string;
};
export type Job = {
  id: string;
  board: string;
  company: string;
  title: string;
  location: string;
  states: string[];
  workMode: string;
  employment: string;
  salary: string | null;
  experience: string | null;
  description: string;
  skills: string[];
  url: string;
  publishedAt: string;
  dateLabel: string;
  checkedAt: string;
  sponsorship: "h1b" | "visa" | "unknown" | "not_sponsored";
  status?: "active" | "closed" | "stale";
  evidence: string;
};
export type ResumeSource = "applydesk" | "custom";
export type Activity = {
  jobId: string;
  action: "saved" | "skipped" | "application";
  status: string;
  job: Job;
  resumeId: string | null;
  resumeSnapshot: ResumeProfile | null;
  resumeSource?: ResumeSource;
  resumeFileName?: string;
  applicationId?: string;
  updatedAt: string;
};
export type Account = {
  user: { userId: string; displayName: string; email: string };
  applicationResumeSource: ResumeSource;
  resumes: Resume[];
  activity: Activity[];
};
export type Feed = {
  jobs: Job[];
  sources: {
    name: string;
    ok: boolean;
    count: number;
    checkedAt: string;
    error?: string;
  }[];
  fetchedAt: string;
};
export const profileLabels: Record<keyof ResumeProfile, string> = {
  name: "Full name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  linkedin: "LinkedIn",
  summary: "Summary",
  experience: "Experience",
  skills: "Technical skills",
  certifications: "Certifications",
  education: "Education",
  projects: "Projects",
  achievements: "Achievements",
};
export const sections: (keyof ResumeProfile)[] = [
  "summary",
  "experience",
  "skills",
  "projects",
  "certifications",
  "achievements",
  "education",
];
export const STATES = [
  "Alabama",
  "Alaska",
  "Arizona",
  "Arkansas",
  "California",
  "Colorado",
  "Connecticut",
  "Delaware",
  "District of Columbia",
  "Florida",
  "Georgia",
  "Hawaii",
  "Idaho",
  "Illinois",
  "Indiana",
  "Iowa",
  "Kansas",
  "Kentucky",
  "Louisiana",
  "Maine",
  "Maryland",
  "Massachusetts",
  "Michigan",
  "Minnesota",
  "Mississippi",
  "Missouri",
  "Montana",
  "Nebraska",
  "Nevada",
  "New Hampshire",
  "New Jersey",
  "New Mexico",
  "New York",
  "North Carolina",
  "North Dakota",
  "Ohio",
  "Oklahoma",
  "Oregon",
  "Pennsylvania",
  "Rhode Island",
  "South Carolina",
  "South Dakota",
  "Tennessee",
  "Texas",
  "Utah",
  "Vermont",
  "Virginia",
  "Washington",
  "West Virginia",
  "Wisconsin",
  "Wyoming",
];
export const ABBR = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
];
export const SKILLS = [
  "Python",
  "SQL",
  "Java",
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "C++",
  "C#",
  "Go",
  "Rust",
  "Scala",
  "Bash",
  "R",
  "HTML",
  "CSS",
  "AWS",
  "Azure",
  "GCP",
  "Snowflake",
  "Databricks",
  "Spark",
  "PySpark",
  "Kafka",
  "Airflow",
  "dbt",
  "ETL",
  "Tableau",
  "Power BI",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "Docker",
  "Kubernetes",
  "Terraform",
  "Git",
  "CI/CD",
  "Linux",
  "TensorFlow",
  "PyTorch",
  "Machine learning",
  "Deep learning",
  "LLM",
  "NLP",
  "Computer vision",
  "Data modeling",
  "Data analysis",
  "Data engineering",
  "Data pipelines",
  "Distributed systems",
  "REST",
  "FastAPI",
  "Django",
  "Flask",
  "Next.js",
  "GraphQL",
  "Figma",
  "Product design",
  "UX",
  "Agile",
  "Scrum",
  "Jira",
  "Salesforce",
  "Excel",
  "Project management",
  "Customer success",
  "Financial modeling",
  "Accounting",
  "Statistics",
  "A/B testing",
  "HIPAA",
  "GDPR",
  "SOC 2",
  "dbt tests",
  "pytest",
];
const aliases: Record<string, string[]> = {
  AWS: ["amazon web services"],
  GCP: ["google cloud"],
  ETL: ["extract transform load"],
  LLM: ["large language model", "large language models"],
  NLP: ["natural language processing"],
  "CI/CD": ["continuous integration", "continuous delivery"],
  "Node.js": ["nodejs", "node.js"],
  "Machine learning": ["machine learning"],
  PostgreSQL: ["postgres"],
  "C++": ["c++"],
  "C#": ["c#"],
};
function hasTerm(text: string, term: string) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
export function extractSkills(text: string) {
  return SKILLS.filter((s) =>
    [s, ...(aliases[s] || [])].some((t) => hasTerm(text, t)),
  );
}
export function profileText(p: ResumeProfile) {
  return Object.values(p).join("\n");
}
export function matchProfile(p: ResumeProfile | null, j: Job) {
  if (!p || !j.skills.length)
    return { score: null, matched: [], missing: j.skills } as {
      score: number | null;
      matched: string[];
      missing: string[];
    };
  const found = extractSkills(profileText(p));
  const matched = j.skills.filter((s) => found.includes(s));
  return {
    score: Math.round((matched.length / j.skills.length) * 100),
    matched,
    missing: j.skills.filter((s) => !found.includes(s)),
  };
}
export function resumeQuality(p: ResumeProfile) {
  return Math.min(
    10,
    Math.round(
      ([
        p.name,
        p.email,
        p.phone,
        p.location,
        p.summary,
        p.experience,
        p.skills,
        p.education,
      ].filter(Boolean).length +
        (/\d+\s?[%+]|\$\d|\d+ (users|records|customers|projects)/i.test(
          p.experience,
        )
          ? 1
          : 0) +
        (p.projects || p.certifications ? 1 : 0)) *
        10,
    ) / 10,
  );
}
export function emptyProfile(): ResumeProfile {
  return {
    name: "",
    email: "",
    phone: "",
    location: "",
    linkedin: "",
    summary: "",
    experience: "",
    skills: "",
    certifications: "",
    education: "",
    projects: "",
    achievements: "",
  };
}
export function parseProfile(text: string): ResumeProfile {
  const p = emptyProfile();
  const rawLines = text.split(/\n/).map((l) => l.trim());
  const lines = rawLines.filter(Boolean);
  p.name =
    lines
      .find((l) => !/resume|curriculum vitae|@|https?:|linkedin/i.test(l))
      ?.slice(0, 120) || "";
  p.email = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || "";
  p.phone =
    text.match(
      /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/,
    )?.[0] || "";
  p.linkedin =
    text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i)?.[0] ||
    "";
  p.location =
    lines
      .slice(0, 8)
      .map((line) =>
        line
          .match(/(?:^|[|•·])\s*([A-Za-z .]+,\s*[A-Z]{2}\b(?:\s+\d{5})?)/)?.[1]
          ?.trim(),
      )
      .find(Boolean) || "";
  let section: keyof ResumeProfile | null = null;
  const heads: [RegExp, keyof ResumeProfile][] = [
    [
      /^(professional |career |executive )?(summary|objective|profile)$/i,
      "summary",
    ],
    [
      /^(professional |work |relevant |employment )?(experience|history)$/i,
      "experience",
    ],
    [
      /^(technical |core |professional )?(skills|competencies|technologies)( and tools)?$/i,
      "skills",
    ],
    [
      /^(education|educational background|academic qualifications)$/i,
      "education",
    ],
    [
      /^(certifications?|licenses?( and certifications)?|certificates)$/i,
      "certifications",
    ],
    [/^(personal |academic |selected |technical )?projects$/i, "projects"],
    [/^(achievements|awards|honors)$/i, "achievements"],
  ];
  for (const line of rawLines) {
    const normalized = line.replace(/[:|]/g, "").trim();
    const h = heads.find(([r]) => r.test(normalized));
    if (h) {
      section = h[1];
      continue;
    }
    if (section) p[section] += (p[section] ? "\n" : "") + line;
  }
  if (!p.skills) p.skills = extractSkills(text).join(", ");
  return p;
}
export function tailorProfile(
  p: ResumeProfile,
  j: Job,
  level: "light" | "substantial",
  confirmed: string[],
): ResumeProfile {
  const next = { ...p };
  const allowed = confirmed.filter((s) => j.skills.includes(s));
  const found = extractSkills(profileText(p));
  const ordered = [
    ...j.skills.filter((s) => found.includes(s) || allowed.includes(s)),
    ...extractSkills(p.skills),
  ];
  const extras = allowed.filter((s) => !found.includes(s));
  next.skills =
    p.skills +
    (extras.length ? `${p.skills ? "\n" : ""}${extras.join(", ")}` : "");
  if (ordered.length) {
    const tokens = next.skills
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    next.skills = tokens
      .sort(
        (a, b) =>
          Number(
            !j.skills.some((k) => a.toLowerCase().includes(k.toLowerCase())),
          ) -
          Number(
            !j.skills.some((k) => b.toLowerCase().includes(k.toLowerCase())),
          ),
      )
      .join(", ");
  }
  if (level === "substantial") {
    // Reorder only bullets within each existing block; never separate roles from employers/dates.
    const result: string[] = [];
    let run: string[] = [];
    const flush = () => {
      result.push(
        ...run.sort(
          (a, b) =>
            extractSkills(b).filter((s) => j.skills.includes(s)).length -
            extractSkills(a).filter((s) => j.skills.includes(s)).length,
        ),
      );
      run = [];
    };
    for (const line of next.experience.split("\n")) {
      if (/^\s*[•*-]/.test(line)) run.push(line);
      else {
        flush();
        result.push(line);
      }
    }
    flush();
    next.experience = result.join("\n");
  }
  return next;
}

export function sponsorshipLabel(j: Job) {
  return j.sponsorship === "h1b"
    ? "H-1B explicitly stated"
    : j.sponsorship === "visa"
      ? "General visa support only"
      : j.sponsorship === "not_sponsored"
        ? "Sponsorship not offered"
        : "Sponsorship unverified";
}

// Existing applications used generated profiles before source selection existed.
export function applicationResumeSource(value: unknown): ResumeSource {
  return value === "custom" ? "custom" : "applydesk";
}
export function resumeSourceLabel(source: ResumeSource) {
  return source === "custom" ? "Custom original" : "ApplyDesk resume";
}
export function feedAvailability(feed: Feed | null) {
  if (!feed) return "loading";
  // The server has already enforced verification freshness on these jobs. A
  // failed latest source attempt must not hide still-current verified listings.
  if (feed.jobs.length) return "ready";
  if (!feed.sources.length) return "awaiting_sources";
  if (!feed.sources.some((source) => source.ok)) return "unavailable";
  if (!feed.jobs.length) return "no_eligible_jobs";
  return "ready";
}

function jobSearchTokens(value: string): string[] {
  return (
    value
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\bs\.w\.e\b/g, "swe")
      .replace(/[\p{Pd}_/.]+/gu, " ")
      .replace(/\bsoftware(engineer|developer)s?\b/g, "software $1")
      .replace(/\b(front|back)[\s_-]*end\b/g, "$1end")
      .replace(/\bfull[\s_-]*stack\b/g, "fullstack")
      .replace(/\b(node|next)[.\s_-]*js\b/g, "$1js")
      .replace(/\b(engineer|developer)s\b/g, "$1")
      .match(/[\p{L}\p{N}]+(?:\+\+|#)?/gu) || []
  );
}
type SearchableJob = Pick<Job, "title" | "company" | "skills"> & {
  description?: string;
};
function isSoftwareRole(job: SearchableJob, title: Set<string>) {
  // An explicit software role stays one when support, hardware or manufacturing
  // describes its domain; the exclusions below apply to ambiguous titles only.
  if (
    /\bsoftware (?:engineer|developer)\b/.test(
      jobSearchTokens(job.title).join(" "),
    ) ||
    title.has("swe") ||
    title.has("sdet")
  )
    return true;
  // Title context prevents a sales/support/hardware job mentioning software in
  // its description from becoming a software-developer search result.
  if (
    [
      "sales",
      "marketing",
      "support",
      "hardware",
      "mechanical",
      "electrical",
      "civil",
      "manufacturing",
      "industrial",
    ].some((word) => title.has(word))
  )
    return false;
  if (!title.has("engineer") && !title.has("developer")) return false;
  if (
    ["software", "frontend", "backend", "fullstack", "android", "ios"].some(
      (word) => title.has(word),
    )
  )
    return true;
  const specialty =
    ["mobile", "desktop", "product", "platform", "ai"].some((word) =>
      title.has(word),
    ) ||
    (title.has("forward") && title.has("deployed"));
  if (!specialty) return false;
  // Do not use SQL, generic cloud tools, or the English words Go/R as evidence.
  const softwareTools = new Set([
    "python",
    "java",
    "javascript",
    "typescript",
    "react",
    "nodejs",
    "c++",
    "c#",
    "rust",
    "scala",
    "kotlin",
    "swift",
    "django",
    "fastapi",
    "flask",
    "nextjs",
    "graphql",
    "tensorflow",
    "pytorch",
  ]);
  if (
    job.skills.some((skill) =>
      jobSearchTokens(skill).some((word) => softwareTools.has(word)),
    )
  )
    return true;
  // Description text only qualifies an already relevant engineering title. It
  // is never a general search field, so incidental words cannot satisfy queries.
  return /\b(?:software (?:development|engineering)|production (?:software|code)|application code)\b|\b(?:build|built|ship|shipped|architect|develop|developed|implement|implemented)\b[^.!?\n]{0,60}\b(?:backend|frontend|web|mobile|android|ios) (?:systems|services|applications?)\b/i.test(
    job.description || "",
  );
}
export function matchesJobQuery(job: SearchableJob, query: string) {
  const wanted = jobSearchTokens(query);
  if (!wanted.length) return true;
  const title = new Set(jobSearchTokens(job.title));
  const softwareRole = isSoftwareRole(job, title);
  const roleQuery =
    wanted.includes("swe") ||
    (wanted.some((word) =>
      [
        "software",
        "frontend",
        "backend",
        "fullstack",
        "mobile",
        "desktop",
        "android",
        "ios",
      ].includes(word),
    ) &&
      wanted.some((word) => word === "engineer" || word === "developer"));
  if (roleQuery && !softwareRole) return false;
  const specialties = [
    "frontend",
    "backend",
    "fullstack",
    "mobile",
    "desktop",
    "android",
    "ios",
  ];
  if (
    roleQuery &&
    wanted.some((word) => specialties.includes(word) && !title.has(word))
  )
    return false;
  const indexed = new Set([
    ...title,
    ...jobSearchTokens(job.company),
    ...job.skills.flatMap(jobSearchTokens),
  ]);
  if (softwareRole)
    ["software", "engineer", "developer", "swe"].forEach((word) =>
      indexed.add(word),
    );
  // Every remaining title, specialty, skill and company token must still match.
  return wanted.every((word) => indexed.has(word));
}
