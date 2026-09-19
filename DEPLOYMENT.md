# ApplyDesk upgrade - Cloudflare deployment

This upgrade uses your existing Cloudflare `applydesk` Worker, GitHub deployment flow, and Supabase project (`rofyegirmgqjhekuxjat`). The original public website, Mission Control portals, recruiter conversations, documents, and role model remain in place. The self-service product is `copilot.html`, with public signup and its own `ad-selfserve-auth` browser session. It does not share the recruiter-managed client membership or records. Administrators use `copilot-admin.html` with their existing `ad-auth` staff session.

Cloudflare Workers Static Assets serves the frontend from `dist`. The job feed refresh runs as a separate Cloudflare Worker with a Cron Trigger. Deploying the static website does not install this scheduled worker.

## What is included

- Recent US jobs with **explicit positive H-1B wording**, a real employer URL, a known source publication date, and a source check within 24 hours. Thirteen configured employer boards; coverage is not exhaustive. Generic visa support, historic sponsorship and transfer-only roles do not qualify.
- PDF and Word **.docx** resumes (5 MB / 30 PDF pages), editable extracted profile sections, original private files, multiple versions, and atomic primary/replace operations.
- Matching based on recognized job-description skill terms; readiness and keyword scores are explained estimates, not scores from an employer's ATS.
- Light skills prioritization or additional bullet prioritization, with missing skills added only after the candidate confirms them. Roles, employers and facts remain intact. No external AI key is required; this implementation uses transparent rules, not a language-model rewrite.
- Times-style formatted PDF, DOCX and LaTeX exports. PDF export uses a separate text renderer; the LaTeX source can be compiled independently. The standard PDF font supports Western text; unsupported characters produce an explicit Word-export fallback rather than being removed. Text-based PDFs are supported; scanned images require conversion to searchable text first. Older `.doc` files must be saved as `.docx`.
- Saved/skipped roles, immutable application resume snapshots, manually updated status, and a handoff to the employer's career site. Opening a page is **Started**, never automatically marked submitted.

## 1. Prepare Supabase and account registration

Back up the live database using your normal Supabase workflow. Review the migration before applying it.

The self-service product needs the existing trusted `app_auth_map`, the shared job-feed tables, and patches 10–11. Check the deployed schema first:

```sql
select to_regclass('public.app_auth_map') as auth_map,
       to_regclass('public.app_clients') as clients,
       to_regclass('public.app_job_pool') as job_pool,
       to_regclass('public.app_job_feed_status') as feed_status,
       to_regclass('public.app_selfserve_members') as selfserve_members;
```

Verify that `app_auth_map` has a UUID `user_id` referencing `auth.users`, a trusted `role` value, and row-level security that prevents browser users from inserting or changing role mappings. The existing mapping and accounts are preserved; do not replay authentication patches 5, 6, or 7 to install this product.

When both `app_job_pool` and `app_job_feed_status` are absent, apply these files in order using the trusted SQL Editor `postgres` role:

1. `supabase/patches/applydesk-self-service-feed-foundation.sql`
2. `supabase/patches/applydesk-patch10-self-service.sql`
3. `supabase/patches/applydesk-patch11-resume-preference.sql`

The feed foundation creates only the shared job pool and feed-status tables, their constraints/index, RLS, and server-role permissions. It is transactional and intentionally aborts if either table already exists. If feed tables are already present, compare their columns and constraints with this file and skip it when compatible; review a scoped change for any missing fields instead of replaying historical migrations.

Patch 10 is transactional and rerunnable. It creates separate `app_selfserve_*` tables, the private `selfserve-resumes` bucket, member/admin RPCs, and RLS policies. It does not copy, enroll, alter or delete recruiter-managed client records. Job listings are shared public-source reference data; member accounts, resumes, saved jobs and applications are separate. Historical patches 8/9 and their managed-client Copilot tables, RPCs, and `client-resumes` bucket are not required by this deployment path. See `supabase/SELF-SERVICE.md` for the data/access contract and runnable local verification commands.

Patch 11 adds a per-member resume preference: ApplyDesk by default, custom original only after an explicit choice. It freezes that source with each application. Apply it before publishing the updated frontend. On a project already running patch 10, apply only patch 11; do not replay patch 10 afterwards because it restores the older application RPC. Patch 11 itself is rerunnable and changes no legacy client records or storage policies.

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

## 3. Deploy the scheduled job-sync Worker

The public job feed refresh runs outside the browser as a Cloudflare Worker:

- Worker source: `cloudflare/job-sync-worker.mjs`
- Worker config: `wrangler.job-sync.toml`
- Cron schedule: every 15 minutes, UTC, via `*/15 * * * *`

In Cloudflare Workers, create these Worker secrets/variables:

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

Set the two secrets when Wrangler prompts, or from the `original-app` folder:

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler.job-sync.toml
npx wrangler secret put JOB_SYNC_SECRET --config wrangler.job-sync.toml
```

The Worker also exposes a protected manual trigger:

```sh
curl -X POST "https://<job-sync-worker-domain>/job-sync" \
  -H "Authorization: Bearer <JOB_SYNC_SECRET>"
```

Use `?dry-run=1` to check public employer feeds without Supabase writes. The production Cron Trigger runs the real persisted sync and updates `app_job_feed_status`.

## 4. Build and deploy from GitHub

Use Node.js 22.13 or newer:

```sh
npm ci
npm run check
npm test
npm run build
```

Push the upgraded project to GitHub. Cloudflare Workers Builds will build and publish `dist` using the settings above. The website deployment does not create the scheduled job-sync Worker or apply Supabase migrations.

After deployment, run the Worker once manually, or wait for the next Cron Trigger. Then inspect `app_job_feed_status` and sign in as a new confirmed self-service member.

A public read-only check that never loads secrets or writes to Supabase is available locally:

```sh
npm run jobs:check
```

## 5. Acceptance checks on your deployment

1. A new self-service member can sign up, confirm their email, sign in and reset their password at `copilot.html`. Confirm no `app_clients` or `app_auth_map` row was created for this member. The existing Mission Control client sign-in and recruiter messages still work separately.
2. An existing admin can open `copilot-admin.html` from Mission Control, search members, inspect resume versions/application snapshots, open private originals, save internal notes, and suspend/restore access. Recruiters, managers and members are denied admin access.
3. Upload a candidate-approved file, check extracted sections, add a second version and choose the primary. Confirm the uploaded original opens with a short-lived signed URL.
4. Job feed source timestamps are current. Verify employer quotes and the filter results. Missing applicant counts and salary remain labeled as unavailable.
5. Tailor, download, and open a job; verify it is only **Started** until the client changes its status. Reopening keeps the original saved snapshot and current status.
6. Test a second self-service member and a recruiter-managed client to verify records and private files stay isolated. Signing out of self-service must not clear the existing staff/client portal session.

## Validation already completed locally

- TypeScript and production build.
- Resume parsing, skill matching, factual preservation, LaTeX escaping, real PDF/DOCX files, and import validation tests.
- Job-feed fixtures for sponsorship denial, transfer-only restrictions, US location, source dates, closure, outages and evidence revocation.
- Disposable PostgreSQL tests cover workspace access, primary/replacement lifecycle and immutable snapshots. The self-service test suite additionally checks separate enrollment, member isolation, admin-only access and suspension; see `supabase/SELF-SERVICE.md`.
- Browser tests with **mocked accounts and intercepted Supabase requests**; these do not validate the currently deployed project's configuration.

No live database migration, client-data update, production Cloudflare deployment, Worker secret update, or real application submission was performed during implementation.

## Operations notes

- Source configuration lives in `workers/companies.json`. Extend it with supported official employer boards and review role evidence; no data vendor promises comprehensive coverage.
- Uploaded originals are immutable. Failed uploads that did not register a resume may leave orphan objects; prune those with a service-role maintenance process after a retention window, never by removing registered snapshots.
- The old optional browser extension is separate from this new desk. Applying does not claim to autofill or submit forms. Download the selected resume and attach it on the employer's site.
- The legacy `apply-board.html` route is now an honest handoff page with a URL allowlist; its previous simulated submission/password form is gone.
