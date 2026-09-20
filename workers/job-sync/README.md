# Employer job sync

Requires Node 22+ and the self-service feed foundation, patch 10, patch 11, and `applydesk-patch12-us-job-catalog.sql`. Apply only migrations missing from the target project; do not rerun patch 10 on an initialized self-service project. Patch 12 adds the broader US catalog and search metadata consumed by this worker.

The Node runner is scheduled separately from the Cloudflare-hosted website by `.github/workflows/job-sync.yml`, every 15 minutes at :07, :22, :37, and :52 UTC, with a manual trigger. Publish it to `main`, configure the repository Actions variable `SUPABASE_URL` and server-only secret `SUPABASE_SERVICE_ROLE_KEY`, retire the existing Cloudflare job-sync Cron Trigger, and verify a persisted manual run and a scheduled run. Missing configuration fails visibly before any fetch or write. The workflow does not run for pull requests, forks, or other branches; only the sync step receives the secret. Scheduled Actions can be delayed, and public-repository schedules can be disabled after 60 days without repository activity. A paid Cloudflare job-sync Worker is an alternative. The Workers Free CPU/request limits are too small for a full refresh of these employer feeds. The website's Cloudflare build does not itself refresh the catalog. See [the deployment instructions](../../DEPLOYMENT.md#3-activate-github-actions-job-refresh) for activation, failure checks, and a future scheduler switch. Keep only one production scheduler enabled; `crons = []` in the Worker config does not itself remove an already-deployed trigger.

```sh
# Offline checks, without environment files or database access:
node --test workers/job-sync/job-sync.test.mjs
# Read-only public ATS smoke check; never loads .env or connects to Supabase:
node workers/job-sync/index.mjs --dry-run
# Write to the configured Supabase project using server-only credentials:
node workers/job-sync/index.mjs
```

## Inclusion policy

- Include all currently listed US roles from the configured employers, across job families and sponsorship categories. A role needs a nonempty title, a valid HTTPS employer application URL without credentials or whitespace, and affirmative US location evidence. Structured provider countries take precedence; “Remote” or “Worldwide” alone does not prove US eligibility. Unlisted, prospect, expired-deadline, and malformed-deadline roles are excluded.
- Sponsorship is a label, not a condition for catalog inclusion. `explicit_h1b` requires a positive employer H-1B statement in that role's current description; generic visa support is `visa_sponsorship`. Explicit immigration sponsorship denials are `not_sponsored`; absent, ambiguous, historical, application-question, and transfer-only evidence is `unknown`. Job-specific negative statements override employer-wide positives. Export-license sponsorship language does not establish an immigration denial. Evidence and its source URL remain available for review; the employer decides eligibility.
- Preserve provider publication dates. Greenhouse `first_published` means first publication. Ashby `publishedAt` means **last published**, which can include republishing. Lever `createdAt` is labeled provider creation. Old or unknown publication dates do not exclude a still-listed role; a user's date filter may exclude them. Future posting dates are excluded. `updated_at`, discovery, and database creation are never substituted for a publication date.
- A source verification must be no older than 24 hours and cannot be in the future. Discovery enforces freshness even if the scheduler stops. No stale source is labeled current merely because a fetch was attempted.
- Public providers do not supply reliable applicant counts. The worker does not invent applicant counts, salaries, experience requirements, work modes, or employment types. Experience level is inferred only from explicit title words. Search skills and the software-role flag use the shared search module against the employer's full description, including Lever requirements and additional sections.

## Source and status contract

`workers/companies.json` accepts either a board-token string or `{ "board": "token", "company": "Display name" }` under `greenhouse`, `lever`, and `ashby`. The configuration is a coverage list, **not** a certified sponsor list or a claim to include all US vacancies. It does not import LinkedIn, Indeed, or Dice listings. Add boards only after verifying a link from the employer's own careers page and a complete, active public ATS response. Boards can legitimately return zero qualifying US jobs.

Rows preserve the existing `dedup_key` and `first_seen_at` across refreshes. Publication basis, verification timestamps, status, location, sponsorship evidence, `search_skills`, and `software_role` remain distinct source facts or clearly labeled derived fields.

A complete successful board response closes previously ingested jobs that disappear. Observed jobs that lose US eligibility or otherwise fail the inclusion policy become stale, and their latest source facts are retained so saved cards cannot show obsolete claims. Sponsorship changes alone do not remove a role. Empty valid feeds close prior jobs; malformed, incomplete, duplicate-ID, HTTP-error, and timeout responses never close jobs. Failed boards retain their last success timestamp and do not stop other boards. `app_job_feed_status` records `syncing`, `ok`, or `failed`, attempt/success dates, last successful counts, and a bounded error message. The CLI exits nonzero if any feed fails.

No private applicant data is sent to public employer feeds, and this worker never submits applications.

## Added employer source evidence

The following employer careers pages link to the added public ATS boards. Feed availability was verified on September 19, 2026. Employer coverage includes software, operations, finance, sales, clinical care, and energy roles; it is still a bounded employer catalog.

| Employer | Official careers page | Public ATS board |
| --- | --- | --- |
| Vercel | https://vercel.com/careers | Greenhouse `vercel` |
| Mercury | https://mercury.com/jobs | Greenhouse `mercury` |
| Figma | https://www.figma.com/careers/ | Greenhouse `figma` |
| Duolingo | https://careers.duolingo.com/ | Greenhouse `duolingo` |
| Reddit | https://redditinc.com/careers | Greenhouse `reddit` |
| Flexport | https://www.flexport.com/careers/ | Greenhouse `flexport` |
| Linear | https://linear.app/careers | Ashby `Linear` |
| Ramp | https://ramp.com/careers | Ashby `ramp` |
| Supabase | https://supabase.com/careers | Ashby `supabase` |
| Cursor | https://cursor.com/careers | Ashby `cursor` |
| Replit | https://replit.com/careers | Ashby `replit` |
| Render | https://render.com/careers | Ashby `render` |
| Commonwealth Fusion Systems | https://cfs.energy/careers/ | Lever `cfsenergy` |
| Included Health | https://includedhealth.com/careers/ | Lever `includedhealth` |

## Provider specifications

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): public jobs, detail `first_published`, and `updated_at`.
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api): `publishedAt` is last publication; structured countries, employment types, workplace types, and compensation.
- [Lever Postings API](https://github.com/lever/postings-api): employer-managed postings, structured countries, description sections, and application links.
- [GitHub scheduled workflow behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule): possible delays and inactivity restrictions.
