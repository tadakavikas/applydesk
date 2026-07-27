# ApplyDesk

Done-for-you job application service. https://getapplydesk.com

## Repository structure

- `index.html` — Public landing page
- `portal.html` — Mission Control (client/team/admin portal)
- `docs/` — Onboarding documents page + downloads
- `supabase/patches/` — SQL migration patches (applied in order)
- `supabase/functions/invite-user/` — Edge Function for role invitations
- `supabase/templates/` — Email templates for Supabase Auth
- `business/` — Business documents (agreement, tracker) — not deployed

## Live infrastructure

- **Hosting:** Netlify (project: getapplydesk)
- **Database + Auth:** Supabase (project: rofyegirmgqjhekuxjat)
- **SMTP:** Google Workspace via hello@getapplydesk.com
- **Domain:** getapplydesk.com (Namecheap)

## Development workflow

1. Edit files locally in VS Code
2. Test in browser (open index.html or portal.html directly, or use Live Server)
3. Commit changes: `git add . && git commit -m "description"`
4. Push to GitHub: `git push origin main`
5. Netlify auto-deploys on push (after we wire it up)

## Manual deploy fallback

If Netlify auto-deploy isn't working:
1. Zip `index.html`, `portal.html`, and `docs/` folder
2. Drop the zip on Netlify → getapplydesk project → Deploys tab

## Contacts

- Admin: Vikas (vikasthadaka43@gmail.com)
- Ops Manager: Pooja (poojaande145@gmail.com)
- Recruiter: Sahithi (sahithigad@gmail.com)
