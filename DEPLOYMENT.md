# ApplyDesk upgrade - Cloudflare deployment

This upgrade uses your existing Cloudflare `applydesk` Worker, GitHub deployment flow, and Supabase project (`rofyegirmgqjhekuxjat`). The original public website, Mission Control portals, recruiter conversations, documents, and role model remain in place. The self-service product is `copilot.html`, with public signup and its own `ad-selfserve-auth` browser session. It does not share the recruiter-managed client membership or records. Administrators use `copilot-admin.html` with their existing `ad-auth` staff session.

Cloudflare Workers Static Assets serves the frontend from `dist`. Feed refresh is a separate server-side operation. The repository includes a Cloudflare job-sync Worker with a 15-minute Cron configuration, but **scheduler selection and runtime credentials are still pending**. Automatic refresh is not established by deploying the website, deploying a Worker without its credentials, or importing jobs once.

## What is included

- Current US jobs from **27 connected employer boards** (13 Greenhouse, 12 Ashby, 2 Lever), across every department represented by those employers. A role needs a valid employer URL, US location evidence, and a source verification within 24 hours. Closed, expired, future-dated, stale and unlisted roles are excluded. Coverage is limited to connected employers; this is not a complete US-market catalog.
- All sponsorship statuses are included by default. Distinct labels identify **H-1B sponsorship stated**, **General visa support**, **Sponsorship not offered**, and **Sponsorship not stated**. Restrictive wording, such as transfer-only requirements, is labeled **Sponsorship restrictions stated** in the same unverified category. The **Not stated / unverified** filter includes both absent and restrictive wording. Employer evidence is retained; generic visa support and historical sponsorship do not imply H-1B support or guarantee candidate eligibility.
- **All current postings** is the default date range. Older postings remain visible while still current; missing publication dates show **Posting date unavailable** and are excluded from the past 30 days, week and 24 hours filters. A source refresh never becomes a fabricated posting date.
- The compact catalog RPC (`fn_ss_job_catalog`) returns metadata in ID-based pages. The browser loads all pages for search and filters, then renders 50 matching cards at a time with **Load more jobs**. Full descriptions load through `fn_ss_job_detail` when a role is opened. Loading failures offer retry and block tailoring/application preparation; saved full descriptions and immutable application snapshots remain readable.
- PDF and Word **.docx** resumes (5 MB / 30 PDF pages), editable extracted profile sections, original private files, multiple versions, and atomic primary/replace operations.
- Matching based on recognized job-description skill terms; readiness and keyword scores are explained estimates, not scores from an employer's ATS.
- Light skills prioritization or additional bullet prioritization, with missing skills added only after the candidate confirms them. Roles, employers and facts remain intact. No external AI key is required; this implementation uses transparent rules, not a language-model rewrite.
- Times-style formatted PDF, DOCX and LaTeX exports. PDF export uses a separate text renderer; the LaTeX source can be compiled independently. The standard PDF font supports Western text; unsupported characters produce an explicit Word-export fallback rather than being removed. Text-based PDFs are supported; scanned images require conversion to searchable text first. Older `.doc` files must be saved as `.docx`.
- Saved/skipped roles, ApplyDesk formatted resumes by default with a persisted explicit custom-original choice, immutable application resume snapshots, manually updated status, and a handoff to the employer's career site. Opening a page is **Started**, never automatically marked submitted.

## 1. Prepare Supabase and account registration

Back up the live database using your normal Supabase workflow. Review the migration before applying it.

The self-service product needs the existing trusted `app_auth_map`, the shared job-feed tables, and patches 10–12. Check the deployed schema first:

```sql
select to_regclass('public.app_auth_map') as auth_map,
       to_regclass('public.app_clients') as clients,
       to_regclass('public.app_job_pool') as job_pool,
       to_regclass('public.app_job_feed_status') as feed_status,
       to_regclass('public.app_selfserve_members') as selfserve_members;
```

Verify that `app_auth_map` has a UUID `user_id` referencing `auth.users`, a trusted `role` value, and row-level security that prevents browser users from inserting or changing role mappings. The existing mapping and accounts are preserved; do not replay authentication patches 5, 6, or 7 to install this product.

### Existing installation through patch 11

Apply only `supabase/patches/applydesk-patch12-us-job-catalog.sql` using the trusted SQL Editor `postgres` role, before publishing this frontend. It adds compact search metadata/indexes, `fn_ss_job_catalog`, `fn_ss_job_detail`, and current-US eligibility shared by discovery and new applications. It preserves patch 11's default/custom resume preference and immutable application snapshots. It does not change managed-client functions, account policies, storage rules or table grants. Do not replay patches 10 or 11 afterwards: they would restore older function definitions.

After patch 12, import freshly verified normalized jobs or run the updated sync to populate `search_skills` and `software_role` as well as current listings and sponsorship labels. The migration creates the API/schema; it does not fetch employer jobs or start a scheduler. Verify catalog pages and a selected full description before the frontend rollout. Existing signup/reset URLs do not need to change for this release.

### First-time self-service installation

When both `app_job_pool` and `app_job_feed_status` are absent, apply these files in order using the trusted SQL Editor `postgres` role:

1. `supabase/patches/applydesk-self-service-feed-foundation.sql`
2. `supabase/patches/applydesk-patch10-self-service.sql`
3. `supabase/patches/applydesk-patch11-resume-preference.sql`
4. `supabase/patches/applydesk-patch12-us-job-catalog.sql`

The feed foundation creates only the shared job pool and feed-status tables, their constraints/index, RLS, and server-role permissions. It is transactional and intentionally aborts if either table already exists. If feed tables are already present, compare their columns and constraints with this file and skip it when compatible; review a scoped change for any missing fields instead of replaying historical migrations.

Patch 10 is transactional and rerunnable. It creates separate `app_selfserve_*` tables, the private `selfserve-resumes` bucket, member/admin RPCs, and RLS policies. It does not copy, enroll, alter or delete recruiter-managed client records. Job listings are shared public-source reference data; member accounts, resumes, saved jobs and applications are separate. Historical patches 8/9 and their managed-client Copilot tables, RPCs, and `client-resumes` bucket are not required by this deployment path. See `supabase/SELF-SERVICE.md` for the data/access contract and runnable local verification commands.

Patch 11 adds a per-member resume preference: ApplyDesk by default, custom original only after an explicit choice. It freezes that source with each application. On a project currently running patch 10, apply patch 11 and then patch 12. Apply only missing migrations in order; do not replay older patches over newer function definitions. The new preference changes no legacy client records or storage policies.

In **Supabase -> Authentication**, enable email/password signup, keep email confirmation enabled, and verify SMTP delivery. Add your production callback URLs under URL Configuration:

- `https://getapplydesk.com/copilot.html`
- `https://getapplydesk.com/copilot.html?recovery=1`
- For local testing: `http://127.0.0.1:5173/copilot.html` and `http://127.0.0.1:5173/copilot.html?recovery=1`.

Use your actual deployed domain if different. Preserve existing portal URLs and SMTP/template configuration. Signup and password-reset templates must use Supabase's confirmation URL so the requested redirect is retained.

Registration confirms the email first, then enrolls only that user in self-service. The self-service enrollment RPC never creates an `app_clients` or `app_auth_map` row. Accounts already linked to the recruiter-managed service or staff are routed to the appropriate portal and cannot be automatically enrolled. A person using both products needs a distinct self-service email/account; no existing account is converted. Admin authority is read from the existing server-side role mapping, never from signup metadata.

### The "workspace is not available yet" error

That message in the previous build meant Supabase could not find a required function/table. The redesigned app shows a dedicated setup-pending screen instead of a half-loaded job dashboard. Apply the pending migrations above in order and retry. A local preview alone does not install database functions. If patch 10 is already applied, check the Supabase project selection and REST schema cache before changing account data.

## 2. Configure Cloudflare Workers Builds

The repository is connected to the existing `applydesk` Worker through Workers Builds. In that Worker's Settings -> Build, use these settings:

| Setting | Value |
|---|---|
| GitHub repository | `tadakavikas/applydesk` |
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | Repository root |
| Static assets directory | `./dist`, configured in `wrangler.toml` |
| Node.js version | `22.13` or newer |

Workers Builds installs dependencies before the build command. Set the build command in the dashboard: Workers Builds does not honor Wrangler's custom `[build]` command. `wrangler.toml` identifies the existing `applydesk` Worker and uploads only `dist`. Keep the existing custom domains and routes. Do not deploy the repository root as static assets: it contains server source and private business files. See [Cloudflare's build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

No Supabase service-role key is needed in the frontend build. The browser uses the existing public Supabase URL/key in `desk-src/lib/client.ts`; do not add service-role secrets to `VITE_*` variables or public files.

## 3. Complete the pending refresh setup

Scheduler selection and runtime credentials are pending. Do not treat the current catalog or a successful one-time import as evidence of automatic refresh. Source verification expires after 24 hours; without another successful sync, affected jobs disappear from discovery.

If Cloudflare is selected for scheduling, the repository provides this Worker option:

- Worker source: `cloudflare/job-sync-worker.mjs`
- Worker config: `wrangler.job-sync.toml`
- Cron schedule: every 15 minutes, UTC, via `*/15 * * * *`

For that Cloudflare option, configure these Worker secrets/variables:

| Name | Type | Value |
|---|---|---|
| `SUPABASE_URL` | Variable | `https://rofyegirmgqjhekuxjat.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Supabase server-only service-role key |
| `JOB_SYNC_SECRET` | Secret | Random 32+ character trigger secret |

Generate the trigger secret with `openssl rand -hex 32`. Never put `SUPABASE_SERVICE_ROLE_KEY` or `JOB_SYNC_SECRET` in browser code, Git, frontend build variables, or chat.

If using Wrangler locally:

```sh
npm run cf:deploy:jobs
```

Set the two secrets in the Cloudflare dashboard, or run these commands from the repository root:

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler.job-sync.toml
npx wrangler secret put JOB_SYNC_SECRET --config wrangler.job-sync.toml
```

The Worker also exposes a protected manual trigger:

```sh
curl -X POST "https://<job-sync-worker-domain>/job-sync" \
  -H "Authorization: Bearer <JOB_SYNC_SECRET>"
```

Use `?dry-run=1` to check public employer feeds without Supabase writes. After scheduler selection and credentials are complete, verify a successful persisted manual run and then a scheduled run in Worker logs and `app_job_feed_status`. The Cron expression in a config file alone is not an operational check. If another scheduler is selected later, document and verify its deployment separately; no alternative scheduler is asserted to be published by this guide.

## 4. Build and deploy from GitHub

Use Node.js 22.13 or newer:

```sh
npm ci
npm run check
npm test
npm run build
```

Push the upgraded project to GitHub. Cloudflare Workers Builds will build and publish `dist` using the settings above. The website deployment does not create the scheduled job-sync Worker or apply Supabase migrations.

After the database migration and a fresh import or persisted sync, inspect `app_job_feed_status` and sign in as a confirmed self-service member. Verify the frontend against the full catalog. Check a scheduled refresh separately once scheduler selection and credentials are complete; do not wait for an unconfigured scheduler to populate the catalog.

A public read-only check that never loads secrets or writes to Supabase is available locally:

```sh
npm run jobs:check
```

## 5. Acceptance checks on your deployment

1. A new self-service member can sign up, confirm their email, sign in and reset their password at `copilot.html`. Confirm no `app_clients` or `app_auth_map` row was created for this member. The existing Mission Control client sign-in and recruiter messages still work separately.
2. An existing admin can open `copilot-admin.html` from Mission Control, search members, inspect resume versions/application snapshots, open private originals, save internal notes, and suspend/restore access. Recruiters, managers and members are denied admin access.
3. Upload a candidate-approved file, check extracted sections, add a second version and choose the primary. Confirm the uploaded original opens with a short-lived signed URL.
4. Job feed source timestamps are current. Verify all sponsorship categories, retained employer quotes, and default all-current results across departments. Search for a role beyond the first 50 cards, load more results, and confirm old/unknown dates are excluded only by recent-date filters. Open a compact card to load its description; a failed detail request must block tailoring/application preparation until retry succeeds. Missing applicant counts and salary remain labeled as unavailable.
5. Tailor, download, and open a job; verify it is only **Started** until the client changes its status. ApplyDesk is the default resume source; explicitly choosing the custom original persists for that member. Download the saved application resume and confirm it matches that source. Reopening keeps the original saved snapshot and current status even after the member changes their preference or library resume.
6. Test a second self-service member and a recruiter-managed client to verify records and private files stay isolated. Signing out of self-service must not clear the existing staff/client portal session.

## Validation already completed locally

- TypeScript, production build, and 53 Node tests passed for this catalog release.
- Resume parsing, skill matching, factual preservation, LaTeX escaping, real PDF/DOCX files, and import validation tests.
- Job-feed fixtures for sponsorship denial, transfer-only restrictions, US location, source dates, closure, outages and evidence revocation.
- Disposable PostgreSQL tests cover workspace access, primary/replacement lifecycle and immutable snapshots. The self-service test suite additionally checks separate enrollment, member isolation, admin-only access and suspension; see `supabase/SELF-SERVICE.md`.
- Fifteen browser cases with **mocked accounts and intercepted Supabase requests** cover existing resume/application flows, sponsorship filters, old/unknown dates, multi-page catalog search, 50-card rendering, detail retry/cancellation, and saved snapshots. These do not validate the currently deployed project's configuration.

These validation results describe local checks. Live migration, feed-import and deployment status must be verified separately; this guide does not establish that the pending scheduler or credentials are configured. No browser test submits a real employer application.

## Operations notes

- Source configuration lives in `workers/companies.json`. Extend it with supported official employer boards and review role evidence; no data vendor promises comprehensive coverage.
- Uploaded originals are immutable. Failed uploads that did not register a resume may leave orphan objects; prune those with a service-role maintenance process after a retention window, never by removing registered snapshots.
- The old optional browser extension is separate from this new desk. Applying does not claim to autofill or submit forms. Download the selected resume and attach it on the employer's site.
- The legacy `apply-board.html` route is now an honest handoff page with a URL allowlist; its previous simulated submission/password form is gone.
