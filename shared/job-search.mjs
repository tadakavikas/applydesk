// Shared catalog metadata and search rules used by ingestion and the workspace.
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
const aliases = {
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
function hasTerm(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
export function extractSkills(text) {
    return SKILLS.filter((s) => [s, ...(aliases[s] || [])].some((t) => hasTerm(text, t)));
}
function jobSearchTokens(value) {
    return (value
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
        .match(/[\p{L}\p{N}]+(?:\+\+|#)?/gu) || []);
}
function isSoftwareRole(job, title) {
    // An explicit software role stays one when support, hardware or manufacturing
    // describes its domain; the exclusions below apply to ambiguous titles only.
    if (/\bsoftware (?:engineer|developer)\b/.test(jobSearchTokens(job.title).join(" ")) ||
        title.has("swe") ||
        title.has("sdet"))
        return true;
    // Title context prevents a sales/support/hardware job mentioning software in
    // its description from becoming a software-developer search result.
    if ([
        "sales",
        "marketing",
        "support",
        "hardware",
        "mechanical",
        "electrical",
        "civil",
        "manufacturing",
        "industrial",
    ].some((word) => title.has(word)))
        return false;
    if (!title.has("engineer") && !title.has("developer"))
        return false;
    if (["software", "frontend", "backend", "fullstack", "android", "ios"].some((word) => title.has(word)))
        return true;
    const specialty = ["mobile", "desktop", "product", "platform", "ai"].some((word) => title.has(word)) ||
        (title.has("forward") && title.has("deployed"));
    if (!specialty)
        return false;
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
    if (job.skills.some((skill) => jobSearchTokens(skill).some((word) => softwareTools.has(word))))
        return true;
    // Description text only qualifies an already relevant engineering title. It
    // is never a general search field, so incidental words cannot satisfy queries.
    return /\b(?:software (?:development|engineering)|production (?:software|code)|application code)\b|\b(?:build|built|ship|shipped|architect|develop|developed|implement|implemented)\b[^.!?\n]{0,60}\b(?:backend|frontend|web|mobile|android|ios) (?:systems|services|applications?)\b/i.test(job.description || "");
}
export function matchesJobQuery(job, query) {
    const wanted = jobSearchTokens(query);
    if (!wanted.length)
        return true;
    const title = new Set(jobSearchTokens(job.title));
    const softwareRole = typeof job.softwareRole === "boolean" ? job.softwareRole : isSoftwareRole(job, title);
    const roleQuery = wanted.includes("swe") ||
        (wanted.some((word) => [
            "software",
            "frontend",
            "backend",
            "fullstack",
            "mobile",
            "desktop",
            "android",
            "ios",
        ].includes(word)) &&
            wanted.some((word) => word === "engineer" || word === "developer"));
    if (roleQuery && !softwareRole)
        return false;
    const specialties = [
        "frontend",
        "backend",
        "fullstack",
        "mobile",
        "desktop",
        "android",
        "ios",
    ];
    if (roleQuery &&
        wanted.some((word) => specialties.includes(word) && !title.has(word)))
        return false;
    const indexed = new Set([
        ...title,
        ...jobSearchTokens(job.company),
        ...job.skills.flatMap(jobSearchTokens),
    ]);
    if (softwareRole)
        ["software", "engineer", "developer", "swe"].forEach((word) => indexed.add(word));
    // Every remaining title, specialty, skill and company token must still match.
    return wanted.every((word) => indexed.has(word));
}
