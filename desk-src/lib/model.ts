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
export type Activity = {
  jobId: string;
  action: "saved" | "skipped" | "application";
  status: string;
  job: Job;
  resumeId: string | null;
  resumeSnapshot: ResumeProfile | null;
  updatedAt: string;
};
export type Account = {
  user: { userId: string; displayName: string; email: string };
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
