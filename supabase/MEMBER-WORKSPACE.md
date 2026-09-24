# Member workspace database contract

Apply `patches/applydesk-patch9-member-workspace.sql` after the existing authentication migration (patch 5), compatibility patch 7, and copilot schema (patch 8). The SQL is transactional and can be rerun. It has **not** been applied to a live Supabase project. Review the real project's schema against the supplied SQL first; the screenshot alone does not establish which patches were deployed.

The existing `auth.users` → `app_auth_map` mapping remains authoritative. New users are still invited/linked through the existing administrator flow. Browser code signs in with Supabase Auth, using the shared `ad-auth` storage key, then calls RPCs with its access token. The new workspace requires `role='client'`; it never accepts a caller-supplied user/client identity. The original recruiter portal and messaging remain unchanged.

## Browser calls

All names below are Supabase RPC names. Failures return `{ok:false,err:string}`; check this as well as the Supabase transport error.

| RPC | Arguments | Success result |
| --- | --- | --- |
| `fn_a_get_my_workspace` | none | `{ok,client_code,resumes,activity,applications,feed_status}` |
| `fn_a_discover_jobs` | `p_limit` integer, default 200, max 1000 | `{ok,jobs,feed_status}` |
| `fn_a_save_my_resume` | `p_file_name,p_storage_path,p_resume_text,p_parsed_profile,p_latex_text,p_replace_id` (optional bigint) | `{ok,resume}` |
| `fn_a_set_primary_resume` | `p_resume_id` | `{ok}` |
| `fn_a_update_my_resume` | `p_resume_id,p_resume_text,p_parsed_profile,p_latex_text` | `{ok}` |
| `fn_a_set_job_activity` | `p_job_id,p_state` (`saved`,`skipped`,`none`) | `{ok}` |
| `fn_a_log_application` | `p_job_id,p_resume_id,p_resume_text,p_latex_text,p_score,p_status` (default `opened`), `p_notes` (default empty), `p_parsed_profile` (optional) | `{ok,id,already,url}` |
| `fn_a_update_application_status` | `p_application_id,p_status` | `{ok}` |

`parsed_profile` is an object. The frontend's fields are `name,email,phone,location,linkedin,summary,experience,skills,certifications,education,projects,achievements`. Application snapshots copy the selected stored profile unless `p_parsed_profile` is supplied. Resume text is required (20–200,000 characters); source extraction must be reviewed before application use. The database does not invent, verify, or infer skills from a job posting.

The active `resumes` array contains `id,client_code,owner_user_id,file_name,storage_path,resume_text,parsed_profile,latex_text,is_primary,created_at,updated_at,archived_at,replaced_by`. Replaced resumes stay in storage and the version table, but are omitted from the active array. Uploading the first resume makes it primary; adding another retains the current primary; replacing a primary transfers selection to the new version. A per-client row lock and partial unique index enforce one primary across concurrent requests. Editing or selecting the primary also updates the existing copilot profile used by legacy matching workers.

`activity` rows contain `job_id,state,updated_at,client_code,job`. The joined `job` object preserves visibility of saved or skipped jobs that have expired. Only discovery and a new application open require current eligibility.

`applications` rows contain `id,client_code,job_id,resume_id,score,status,notes,created_at,updated_at,applied_at,job_snapshot,resume_snapshot`. Convenience fields `company,title,url,file_name,resume_text,latex_text` are also returned. `resume_snapshot` contains `resume_id,file_name,storage_path,resume_text,latex_text,parsed_profile` captured at the **first** opening for that client/job. Repeated `fn_a_log_application` calls return `{already:true}` without replacing that snapshot or changing status. The UI should show that an existing application is being reopened. Use the status RPC to report progress; do not imply a subsequent export replaced the saved snapshot.

Allowed statuses are `opened,applied,interview,offer,rejected,withdrawn`. `opened` means only that the member chose to open an external application; it does not mean the employer received it. All later statuses are member-reported. The app does not auto-submit or manufacture employer confirmation. A trigger prevents changing snapshot content even via normal service-role updates. Self-service applications remain a separate table from recruiter-created `app_records` so opening a link cannot inflate legacy submitted-application counts. Assigned recruiters and managers/admins can read the new table under RLS for future portal integration.

## Private source documents

Use the private `client-resumes` bucket. Upload with `upsert:false` to `${session.user.id}/${crypto.randomUUID()}/${safeFileName}`. The bucket enforces a 5 MiB maximum and PDF/DOCX MIME types. Supply the correct `contentType` because browsers may not populate the DOCX MIME type. Registration checks that this upload exists and belongs to the caller's user-id folder. Use Supabase Storage signed URLs for viewing/downloading; never use `getPublicUrl`.

There is no browser overwrite or delete policy. Replacing a resume uploads a new object and atomically archives the old database version. This retains original files referenced by historical application snapshots. Service-side maintenance may clean up abandoned, unregistered uploads; never delete a path referenced by `app_member_resumes`. Review any pre-existing broad `storage.objects` policies before deploying: PostgreSQL permissive policies combine with OR, so an older unrestricted storage policy could bypass a new bucket policy. This migration creates narrowly scoped policies but does not delete unrelated application policies.

## Feed truth and maintenance

Discovery requires every condition: US job; active; explicitly positive `explicit_h1b` evidence with HTTPS source URL; known source publication basis; publication within 30 days; and successful source verification within 24 hours. Jobs with generic visa sponsorship, unknown dates, expired verification, no evidence, or closed status are excluded. Source update time is separate from publication time. No applicant counts are generated. This is limited to configured, successfully synchronized employer feeds; it is not a complete index of every H-1B job.

`app_job_feed_status` accepts `pending,syncing,ok,failed`. Workers use service-role credentials outside the browser. Public-facing RPCs return source/company, attempt/success timestamps, status and counts, excluding internal error details. Job source errors do not imply no openings: inspect the feed status. A scheduled synchronization job is required for a continuously fresh feed.

## Local verification

`tests/bootstrap-local.sql` creates minimal Supabase platform objects in a **fresh disposable local PostgreSQL database**, then loads patches 8 and 9. Never run this bootstrap against Supabase/production. `tests/member-workspace.sql` uses fixture clients and jobs inside a rolled-back transaction to test ownership, anonymous/unmapped denial, assigned recruiter access, original file retention, primary/replacement behavior, strict discovery, idempotent openings, and immutable history. Example after starting an isolated PostgreSQL instance:

```sh
psql -h /your/local/socket -p YOUR_TEST_PORT -d postgres -X -q \
  -f supabase/tests/bootstrap-local.sql \
  -f supabase/tests/member-workspace.sql
```

This test models Storage metadata and RLS, not the actual Storage HTTP service's MIME/size enforcement, email authentication, or production data migration. Verify signed downloads, Supabase Auth redirects and an authenticated upload in a staging project before deployment. Legacy code-based RPC grants from old patches are unchanged; assess the original application's authentication cutover separately.
