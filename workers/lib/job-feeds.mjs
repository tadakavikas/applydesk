// Public ATS parsing, independent of environment variables and persistence.
import { extractSkills, matchesJobQuery } from '../../shared/job-search.mjs';
export const DAY_MS = 86400000;
export const RECENT_DAYS = 30;
export const FRESH_HOURS = 24;
const US_COUNTRIES = /^(US|USA|United States(?: of America)?)$/i;
const STATE_NAMES = /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b/i;
const STATE_ABBREVIATIONS = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?:\b|$)/;
const H1B = /\bH[\s‑–-]?1[\s‑–-]?B\b/i;

export function cleanText(value) {
  let text = String(value || '');
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ndash: '–', mdash: '—', bull: '•' };
  // Greenhouse returns entity-encoded HTML, occasionally encoded twice.
  for (let i = 0; i < 3; i++) text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? all;
    const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}

export function sponsorshipEvidence(description) {
  const text = cleanText(description);
  const sentences = text.match(/[^.!?]+(?:[.!?]+|$)/g) || [];
  const relevant = sentences.filter(s => /sponsor|\b(?:visas?|petitions?|lottery)\b|\bH[\s‑–-]?1[\s‑–-]?B\b/i.test(s));
  // Negative job-specific statements override employer-wide positive boilerplate.
  const negative = relevant.find(s => /\b(?:do not|does not|don't|doesn't|cannot|can't|will not|won't|unable to|not able to)\s+(?:currently\s+|at this time\s+)?(?:offer\s+|provide\s+|support\s+)?(?:any\s+)?(?:visa\s+|H[\s‑–-]?1[\s‑–-]?B\s+)?sponsor/i.test(s)
    || /\b(?:visa\s+|H[\s‑–-]?1[\s‑–-]?B\s+)?sponsorship\s+(?:is\s+)?(?:not available|not offered|unavailable|not supported)/i.test(s)
    || /\bH[\s‑–-]?1[\s‑–-]?B\s+visas?\s+(?:are\s+|is\s+)?not\s+(?:supported|available|offered)/i.test(s)
    || /\b(?:must not|cannot|can't)\s+require\s+(?:visa\s+|employer\s+)?sponsorship/i.test(s)
    || /\bwithout\s+(?:the need for\s+|requiring\s+)?(?:current or future\s+|now or future\s+|employment\s+|visa\s+|employer\s+)*sponsorship\b(?!\s+for\s+(?:an?\s+)?export\s+licen[cs]e)/i.test(s)
    || /\bno\s+(?:visa\s+|H[\s‑–-]?1[\s‑–-]?B\s+)?sponsorship\b/i.test(s));
  if (negative) return { sponsorship_status: 'not_sponsored', sponsorship_evidence: negative.trim().slice(0, 1000) };
  // Transfer-only/existing-holder eligibility does not establish sponsorship for
  // a graduate who needs a first H-1B petition. Retain the restriction as evidence.
  const restricted = relevant.find(s => /\bH[\s‑–-]?1[\s‑–-]?B\b.{0,60}\b(?:transfers?|holders?)\b(?:\s+(?:sponsorship|candidates?|visa))?[\s-]+only\b/i.test(s)
    || /\bonly\b.{0,40}\b(?:existing\s+|current\s+)?H[\s‑–-]?1[\s‑–-]?B\b.{0,35}\b(?:transfers?|holders?|candidates?)\b/i.test(s)
    || /\bonly\s+(?:existing|current)\s+H[\s‑–-]?1[\s‑–-]?B\b/i.test(s)
    || /\b(?:existing|current)\s+H[\s‑–-]?1[\s‑–-]?B\s+(?:visa\s+)?holders?\b.{0,30}\bonly\b/i.test(s)
    || /\bmust\b.{0,35}\b(?:hold|have|be on)\b.{0,20}\bH[\s‑–-]?1[\s‑–-]?B\b/i.test(s)
    || /\b(?:no|not|not accepting|not supporting|not filing)\s+new\s+(?:H[\s‑–-]?1[\s‑–-]?B\s+)?(?:petitions?|visas?|sponsorship)\b/i.test(s)
    || /\b(?:do not|don't|cannot|can't|will not|won't)\b.{0,20}\b(?:file|support|sponsor)\b.{0,20}\b(?:new|initial|cap[- ]subject|lottery)\b/i.test(s)
    || /\b(?:no|without)\s+(?:H[\s‑–-]?1[\s‑–-]?B\s+)?lottery\s+sponsorship\b/i.test(s));
  if (restricted) return { sponsorship_status: 'unknown', sponsorship_evidence: restricted.trim().slice(0, 1000) };
  const positive = relevant.find(s => H1B.test(s) && !/\?|\b(?:require|need|seek)\w*\s+(?:visa\s+)?sponsorship|\b(?:previous|past|historical)\b/i.test(s)
    && (/\b(?:we|company|employer)\s+(?:actively\s+|can\s+|will\s+|do\s+|also\s+|are able to\s+)?(?:sponsor|provide\s+(?:visa\s+)?sponsorship|offer\s+(?:visa\s+)?sponsorship|support\s+(?:visa\s+)?sponsorship)\b/i.test(s)
      || /\b(?:visa\s+|H[\s‑–-]?1[\s‑–-]?B\s+)?sponsorship\s+(?:is\s+)?(?:available|provided|offered)\b/i.test(s)));
  if (positive) {
    const index = sentences.indexOf(positive);
    const next = sentences[index + 1] || '';
    const evidence = (positive + (/sponsor|visa|guarantee|eligib/i.test(next) ? next : '')).trim();
    const start = Math.max(0, evidence.search(H1B) - 250);
    return { sponsorship_status: 'explicit_h1b', sponsorship_evidence: (start ? '…' : '') + evidence.slice(start, start + 1000) };
  }
  const general = relevant.find(s => !/\?/.test(s) && /\b(?:we\s+(?:can\s+|will\s+|do\s+)?sponsor\s+visas?|visa sponsorship\s+(?:is\s+)?(?:available|provided|offered))\b/i.test(s));
  const next = general ? sentences[sentences.indexOf(general) + 1] || '' : '';
  const evidence = general ? general + (/sponsor|visa|guarantee|eligib/i.test(next) ? next : '') : '';
  return { sponsorship_status: general ? 'visa_sponsorship' : 'unknown', sponsorship_evidence: evidence.trim().slice(0, 1000) };
}

export function isUSLocation(location, addresses = []) {
  const countries = addresses.map(a => a?.postalAddress?.addressCountry || a?.addressCountry).filter(Boolean);
  if (countries.some(country => US_COUNTRIES.test(country))) return true;
  if (countries.length) return false;
  // A remote/global label alone is not evidence that a role can be performed in the US.
  return String(location || '').split(/;|\||\s\/\s/).some(part => {
    if (/\b(?:United States|USA|U\.S\.|US)\b/.test(part)) return true;
    if (/\b(?:Canada|United Kingdom|UK|Europe|India|Australia|Germany|France|Singapore|Brazil|Mexico|Ontario|British Columbia)\b/i.test(part)) return false;
    return STATE_NAMES.test(part) || STATE_ABBREVIATIONS.test(part) || /\b(?:San Francisco|Seattle|New York City|NYC|Los Angeles|Boston|Chicago|San Jose|San Diego|Austin|Washington DC|Washington, D\.C\.)\b/i.test(part);
  });
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}

function metadata(title, location, description, job) {
  const commitment = job.employmentType || job.categories?.commitment || '';
  const employment_type = /full.?time/i.test(commitment) ? 'Full-time' : /part.?time/i.test(commitment) ? 'Part-time' : /intern/i.test(commitment) ? 'Internship' : /contract/i.test(commitment) ? 'Contract' : /temporary/i.test(commitment) ? 'Temporary'
    : /\b(?:C2C|corp(?:oration)?[- ]to[- ]corp(?:oration)?)\b/i.test(title) ? 'Corp-to-corp' : /\bW[- ]?2\s+contract/i.test(title) ? 'W2 contract' : /\bcontract\b/i.test(title) ? 'Contract' : /\bfull[- ]time\b/i.test(description) ? 'Full-time' : '';
  const workplace = job.workplaceType || job.workplace_type || '';
  const work_mode = /hybrid/i.test(workplace) ? 'Hybrid' : /remote/i.test(workplace) ? 'Remote' : /on.?site/i.test(workplace) ? 'Onsite' : job.isRemote === true || /\bremote\b/i.test(location) ? 'Remote' : /\bhybrid\b/i.test(location) ? 'Hybrid' : /\bon[- ]?site\b/i.test(location) ? 'Onsite' : '';
  const years_required = (description.match(/\b\d+(?:\s*[-–]\s*\d+|\+)?\s+years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|industry\s+)?experience\b/i) || [])[0] || '';
  const salary_text = cleanText(job.compensation?.scrapeableCompensationSalarySummary || job.compensation?.compensationTierSummary || '')
    || (description.match(/\$\s*\d[\d,.]*(?:\s*[kK])?(?:\s*[-–—]\s*\$?\s*\d[\d,.]*(?:\s*[kK])?)(?:\s*(?:per\s+|\/)(?:year|hour|annum|hr))?/i) || [])[0] || '';
  const role_level = /\b(?:senior|sr\.?|staff|principal|lead)\b/i.test(title) ? 'Senior' : /\b(?:junior|jr\.?|entry|intern|new grad|graduate)\b/i.test(title) ? 'Entry' : '';
  return { employment_type, work_mode, years_required, salary_text, role_level };
}

export function normalizeJob(source, board, company, job, now) {
  const id = job.id || job.jobId;
  if (id == null || id === '') throw new Error('Employer feed contains a job without an ID');
  const title = cleanText(job.title || job.text);
  const companyName = cleanText(job.company_name || company);
  const locations = source === 'ashby' ? [job.location, ...(job.secondaryLocations || []).map(item => item.location)] : source === 'lever' ? job.categories?.allLocations || [job.categories?.location] : [job.location?.name];
  const location = [...new Set(locations.filter(Boolean))].join('; ');
  // Lever separates requirements and benefits into lists/additional sections.
  // Include those public source facts when extracting skills and sponsorship.
  const description = cleanText(source === 'lever' ? [
    job.descriptionPlain || job.description || '',
    ...(job.lists || []).map(item => `${item.text || ''}: ${item.content || ''}`),
    job.additionalPlain || job.additional || '',
  ].join(' ') : job.descriptionPlain || job.content || job.descriptionHtml || job.description || '');
  const search_skills = extractSkills(description);
  const software_role = matchesJobQuery({ title, company: companyName, skills: search_skills, description }, 'software developer');
  const posted_at = source === 'greenhouse' ? dateOrNull(job.first_published) : source === 'ashby' ? dateOrNull(job.publishedAt) : dateOrNull(job.createdAt);
  const url = safeUrl(job.absolute_url || job.jobUrl || job.hostedUrl || job.applyUrl);
  const addresses = source === 'ashby' ? [job.address, ...(job.secondaryLocations || []).map(item => item.address)]
    : source === 'lever' && job.country ? [{ addressCountry: job.country }] : [];
  return {
    company: companyName, title, source, source_board: board, source_job_id: String(id), url,
    posted_at, date_basis: !posted_at ? 'unknown' : source === 'greenhouse' ? 'first_published' : source === 'ashby' ? 'last_published' : 'provider_created',
    source_updated_at: dateOrNull(job.updated_at || job.updatedAt), ats_type: source, location, description: description.slice(0, 60000),
    search_skills, software_role,
    ...metadata(title, location, description, job), dedup_key: `${source}:${board.toLowerCase()}:${id}`,
    country_code: isUSLocation(location, addresses) ? 'US' : '', ...sponsorshipEvidence(description), sponsorship_evidence_url: url,
    status: 'active', closed_at: null, last_seen_at: now, last_verified_at: now, verification_confidence: 1,
    // Preserve malformed supplied deadlines so neither the worker nor the API
    // silently treats bad source data as an unrestricted posting.
    raw_json: { id: String(id), board, is_listed: job.isListed !== false, is_prospect: source === 'greenhouse' && job.internal_job_id === null,
      application_deadline: job.application_deadline == null ? null : dateOrNull(job.application_deadline) ?? String(job.application_deadline) },
  };
}

export function isEligibleJob(row, now) {
  const posted = Date.parse(row.posted_at);
  const time = Date.parse(now);
  const verified = Date.parse(row.last_verified_at);
  const rawDeadline = row.raw_json?.application_deadline;
  const deadline = Date.parse(rawDeadline);
  // Sponsorship is a searchable label, not a condition for inclusion. Old and
  // unknown publication dates remain honest while source verification is fresh.
  return Boolean(String(row.title || '').trim() && typeof row.url === 'string'
    && !/\s/.test(row.url) && safeUrl(row.url) && row.status === 'active' && row.country_code === 'US'
    && row.raw_json?.is_listed !== false && row.raw_json?.is_prospect !== true
    && Number.isFinite(time) && Number.isFinite(verified) && verified >= time - FRESH_HOURS * 3600000 && verified <= time
    && (row.posted_at == null || (Number.isFinite(posted) && posted <= time))
    && (rawDeadline == null || (Number.isFinite(deadline) && deadline > time)));
}

export function configuredBoards(config) {
  return ['greenhouse', 'lever', 'ashby'].flatMap(source => (config[source] || []).map(entry => {
    const board = typeof entry === 'string' ? entry : entry.board;
    if (!/^[a-zA-Z0-9_-]+$/.test(board)) throw new Error(`Invalid ${source} board name`);
    return { source, board, company: typeof entry === 'string' ? entry : entry.company || board };
  }));
}

async function fetchJSON(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Employer feed HTTP ${response.status}`);
  return response.json();
}

export async function fetchBoard({ source, board, company }, { fetchImpl = fetch, now = new Date().toISOString() } = {}) {
  const token = encodeURIComponent(board);
  const url = source === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true` : source === 'ashby' ? `https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true` : `https://api.lever.co/v0/postings/${token}?mode=json`;
  const data = await fetchJSON(url, fetchImpl);
  const jobs = source === 'lever' ? data : data.jobs;
  if (!Array.isArray(jobs)) throw new Error('Employer feed returned an invalid jobs payload; closure skipped');
  if (source === 'greenhouse' && data.meta?.total != null && Number(data.meta.total) !== jobs.length) throw new Error('Employer feed is incomplete; closure skipped');
  const rows = [];
  for (let job of jobs) {
    let row = normalizeJob(source, board, company, job, now);
    // Some Greenhouse boards only expose first_published in their detail endpoint.
    // Do not infer a posting date from updated_at or from when ApplyDesk discovered it.
    if (source === 'greenhouse' && row.country_code === 'US' && row.sponsorship_status === 'explicit_h1b' && !row.posted_at) {
      job = await fetchJSON(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${encodeURIComponent(row.source_job_id)}`, fetchImpl);
      row = normalizeJob(source, board, company, job, now);
    }
    rows.push(row);
  }
  if (new Set(rows.map(row => row.source_job_id)).size !== rows.length) throw new Error('Employer feed returned duplicate IDs; closure skipped');
  return rows;
}
