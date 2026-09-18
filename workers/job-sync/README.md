# Employer job sync

Requires Node 22+ and `applydesk-patch9-member-workspace.sql` after the existing patch 8. The existing `node workers/hourly.mjs` process still runs the sync and matching workers for local/server use. In production, deploy `cloudflare/job-sync-worker.mjs` with `wrangler.job-sync.toml`; Cloudflare Cron Triggers run the same sync every 15 minutes.

```sh
# Offline checks, without environment files or database access:
node --test workers/job-sync/job-sync.test.mjs
# Read-only public ATS smoke check; never loads .env or connects to Supabase:
node workers/job-sync/index.mjs --dry-run
# Write to the configured Supabase project using the existing server-only credentials:
node workers/job-sync/index.mjs
```

## Inclusion policy

- The role must have a US location, a valid HTTPS employer application URL, and an affirmative H-1B statement in its current employer-provided description. Generic visa support, a historical sponsor reputation, and an application question about needing sponsorship are insufficient. Negative role-specific wording overrides a positive employer statement. Transfer-only or existing-holder-only roles and roles excluding new petitions do not establish sponsorship for a new graduate, so they are excluded. The quoted evidence and its source URL are saved for review; eligibility is still the employer's decision.
- The provider must supply a posting date within the past 30 days. Greenhouse `first_published` means first publication; the worker requests the job detail if the list omits it. Ashby `publishedAt` means **last published**, which can include republishing. Lever `createdAt`, when supplied, is labeled provider creation. `updated_at`, first discovery, and database creation are never presented as posting dates. Unknown dates are excluded.
- Public providers do not supply reliable applicant counts. The worker does not invent them, salaries, years required, work modes, or an employment type when the source omits them. Inferred experience level comes from explicit words in the job title.
- Roles more than 24 hours past the last successful source verification are stale. Discovery enforces the same freshness limit even if the worker stops. Expired deadlines and unlisted/prospect roles are excluded.

## Source and status contract

`workers/companies.json` accepts either a board-token string or `{ "board": "token", "company": "Display name" }` under `greenhouse`, `lever`, and `ashby`. The configuration is a source coverage list, **not** a certified sponsor list or a claim to include all US vacancies. Add official ATS board tokens to extend coverage. Boards can legitimately return zero qualifying jobs.

Rows use the existing `dedup_key` format, preserving identity across refreshes. The patch adds `source_board`, `source_job_id`, `date_basis`, `source_updated_at`, `first_seen_at`, `last_seen_at`, `last_verified_at`, `closed_at`, `status`, `country_code`, `sponsorship_status`, `sponsorship_evidence`, and `sponsorship_evidence_url`. `first_seen_at` is preserved during upsert.

A complete successful board response closes previously ingested jobs that disappear. Observed jobs that no longer pass the inclusion policy become stale, and their source facts and sponsorship evidence are refreshed so saved cards cannot retain obsolete claims. Empty valid feeds close prior jobs; malformed, incomplete, duplicate-ID, HTTP-error, and timeout responses never close jobs. Failed boards retain their last success timestamp and do not stop other boards. The `app_job_feed_status` table records `syncing`, `ok`, or `failed`, attempt/success dates, last successful counts, and a bounded error message. The CLI exits nonzero if any feed fails.

The worker's candidate pool is intentionally conservative. No private applicant data is sent to employer feeds, and it never submits applications.

## Provider specifications

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): public jobs, detail `first_published`, and `updated_at`.
- [Ashby public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api): `publishedAt` is last publication; structured countries, employment types, workplace types, and compensation.
- [Lever Postings API](https://github.com/lever/postings-api): employer-managed postings and application links.
