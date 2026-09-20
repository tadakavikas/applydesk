# ApplyDesk

Done-for-you job application service. https://getapplydesk.com

## Self-service product

The upgraded `copilot.html` provides current US job discovery across 27 connected employer boards, private resume versions, reviewed profiles, matching, exports and application tracking. All sponsorship statuses and all current posting dates are included by default; roles span software, data, sales, marketing, finance and other departments represented on those boards. Coverage is limited to these connected employers, not the whole US market. It has its own signup/login session and member data. Existing recruiter-managed clients stay in Mission Control. Administrators manage self-service members at `copilot-admin.html` using their existing staff session.

Read [DEPLOYMENT.md](DEPLOYMENT.md) before enabling it on your existing Cloudflare/Supabase project. A project already initialized through patch 11 needs only `supabase/patches/applydesk-patch12-us-job-catalog.sql` for this catalog release, followed by a fresh feed import or sync. Do not replay older authentication or self-service patches. The deployment guide also covers first-time setup, signup/reset redirects, and Cloudflare Workers Builds. `npm run dev` opens the local project; visit `/copilot.html`. `npm run build` packages both the self-service and admin desks and preserves the existing public site and portals.

Sponsorship badges distinguish **H-1B sponsorship stated**, **General visa support**, **Sponsorship not offered**, and **Sponsorship not stated**. Listings with restrictive wording, such as transfer-only requirements, show **Sponsorship restrictions stated** in the unverified category; the employer quote remains available. These labels describe listing text, not an individual eligibility guarantee.

The browser loads the full current catalog as compact metadata pages, searches across those pages, and renders 50 cards at a time. It fetches the full description when a role is opened, before preparing an application. The ApplyDesk formatted resume remains the default for applications unless the member explicitly chooses their uploaded custom original; each application preserves its saved source and snapshot.

**Automatic feed refresh is pending:** scheduler selection and runtime credentials still need to be completed. A website deployment or one-time feed import does not configure ongoing refresh. Jobs require a successful source verification within 24 hours, so they stop appearing if no fresh sync occurs.

## Repository structure

- `index.html` — Public landing page
- `portal.html` — Mission Control (client/team/admin portal)
- `docs/` — Onboarding documents page + downloads
- `supabase/patches/` — SQL migration patches (applied in order)
- `supabase/functions/invite-user/` — Edge Function for role invitations
- `supabase/templates/` — Email templates for Supabase Auth
- `business/` — Business documents (agreement, tracker) — not deployed

## Live infrastructure

- **Hosting:** Cloudflare Workers Static Assets, deployed from GitHub through Workers Builds
- **Database + Auth:** Supabase (project: rofyegirmgqjhekuxjat)
- **SMTP:** Google Workspace via hello@getapplydesk.com
- **Domain:** getapplydesk.com (Namecheap)

## Development workflow

1. Edit files locally in VS Code
2. Test in browser (open index.html or portal.html directly, or use Live Server)
3. Commit changes: `git add . && git commit -m "description"`
4. Push to GitHub: `git push origin main`
5. Cloudflare Workers Builds auto-deploys on push

## Manual deploy fallback

If Cloudflare auto-deploy is unavailable, run `npm run build` followed by `npx wrangler deploy` in this repository using the existing Cloudflare account. `wrangler.toml` serves only the generated `dist/` folder through the existing `applydesk` Worker. The checked-in Cloudflare job-sync Worker is separate from the website deployment; its 15-minute Cron configuration does not establish that runtime credentials or automatic refresh are operational. See the pending scheduler setup in the deployment guide.

## Contacts

- Admin: Vikas (vikasthadaka43@gmail.com)
- Ops Manager: Pooja (poojaande145@gmail.com)
- Recruiter: Sahithi (sahithigad@gmail.com)
