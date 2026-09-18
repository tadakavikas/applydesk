# ApplyDesk

Done-for-you job application service. https://getapplydesk.com

## Self-service product

The upgraded `copilot.html` provides H-1B job discovery, private resume versions, reviewed profiles, matching, exports and application tracking. It has its own signup/login session and member data. Existing recruiter-managed clients stay in Mission Control. Administrators manage self-service members at `copilot-admin.html` using their existing staff session.

Read [DEPLOYMENT.md](DEPLOYMENT.md) before enabling it on your existing Cloudflare/Supabase project. Patch 10 (after prerequisites 5, 7, 8, 9), Supabase signup/email redirect settings, Cloudflare Pages build settings, and the Cloudflare job-sync Worker secrets are required. `npm run dev` opens the local project; visit `/copilot.html`. `npm run build` packages both the self-service and admin desks and preserves the existing public site and portals.

## Repository structure

- `index.html` — Public landing page
- `portal.html` — Mission Control (client/team/admin portal)
- `docs/` — Onboarding documents page + downloads
- `supabase/patches/` — SQL migration patches (applied in order)
- `supabase/functions/invite-user/` — Edge Function for role invitations
- `supabase/templates/` — Email templates for Supabase Auth
- `business/` — Business documents (agreement, tracker) — not deployed

## Live infrastructure

- **Hosting:** Cloudflare Pages, deployed from GitHub
- **Database + Auth:** Supabase (project: rofyegirmgqjhekuxjat)
- **SMTP:** Google Workspace via hello@getapplydesk.com
- **Domain:** getapplydesk.com (Namecheap)

## Development workflow

1. Edit files locally in VS Code
2. Test in browser (open index.html or portal.html directly, or use Live Server)
3. Commit changes: `git add . && git commit -m "description"`
4. Push to GitHub: `git push origin main`
5. Cloudflare Pages auto-deploys on push

## Manual deploy fallback

If Cloudflare Pages auto-deploy is unavailable, run `npm run build` and upload the generated `dist/` folder with Cloudflare Pages Direct Upload or `wrangler pages deploy dist`. The scheduled feed refresh is a separate Cloudflare Worker and is not included in a static Pages upload.

## Contacts

- Admin: Vikas (vikasthadaka43@gmail.com)
- Ops Manager: Pooja (poojaande145@gmail.com)
- Recruiter: Sahithi (sahithigad@gmail.com)
