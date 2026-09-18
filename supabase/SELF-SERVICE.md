# ApplyDesk self-service accounts

Patch 10 gives ApplyDesk's self-service job-search product its own membership and records. It uses the same Supabase project and verified employer feed, while keeping recruiter-managed clients in the existing portal.

## Deploy the database

Apply `patches/applydesk-patch10-self-service.sql` after the existing schema and patches 5, 7, 8 and 9. The migration is transactional and rerunnable. It creates empty self-service tables; it does not import clients, copy resumes, alter existing memberships, update legacy profiles, or assign recruiters. Do not replay the historical patch 6 data-preparation updates just to install this feature.

The frontend must use the `fn_ss_*` RPCs and `selfserve-resumes` bucket. The earlier `fn_a_*` member workspace remains a historical managed-client API, separate from this product. Applying patch 10 alone does not change any production frontend or Auth configuration.

Enable email/password signup and email verification in Supabase Auth. Set the production site's allowed signup/recovery redirect URL to the self-service portal route used by the frontend. New users sign up, verify their email, and call `fn_ss_enroll(p_full_name)` with their own authenticated session. No service-role key belongs in a browser. Keep existing staff and client Auth accounts intact.

A signup matching an existing managed-client or staff account cannot enroll in self-service. The existing patch 6 email-linking trigger can identify a previously listed staff/client email as a legacy account even during signup. The user needs a separate email for the self-service product. Nothing auto-converts the existing account.

## Records and permissions

| Resource | Self-service member | Existing administrator | Recruiter / manager / managed client |
| --- | --- | --- | --- |
| Self-service profile | Own limited identity | List, inspect, suspend/reactivate, private notes | No access |
| Resume versions and parsed content | Own active account | Inspect all versions including archived | No access |
| Original PDF/DOCX | Own active account | Download registered originals | No access |
| Saved/skipped jobs and applications | Own active account | Inspect | No access |
| Administrator audit | No access | Inspect latest 100 events per member | No access |
| Managed-client records | No access from this product | Existing portal permissions | Existing portal permissions |

Only a trusted `app_auth_map` row with `role='admin'` authorizes the administration API. A metadata field, email domain, manager role, recruiter assignment, or self-service signup cannot grant that access. The migration never creates administrator roles.

Independent tables are `app_selfserve_members`, `app_selfserve_resumes`, `app_selfserve_job_activity`, `app_selfserve_applications` and `app_selfserve_admin_audit`. Ownership uses Auth user UUIDs. There are no `app_clients` foreign keys or writes to `app_copilot_profiles`, `app_records` or the patch 9 member tables. Email is read from Auth when needed, avoiding a second stale copy.

Row-level security protects direct reads. Browser users cannot write these tables directly. Definer RPCs check the caller's authenticated UUID; member mutations lock the membership row to serialize primary selection and administrator suspension. A suspended member receives their status from the identity RPC, but cannot load or mutate their workspace or access storage. If a member is subsequently mapped to a legacy role, self-service access is denied without deleting their records.

The private `selfserve-resumes` bucket accepts PDF/DOCX files up to 5 MB. Uploads must be under `<auth-user-id>/<unique-id>/<file-name>`. Storage guards continue to protect this bucket even if another pre-existing authenticated storage policy is broad. No browser overwrite or delete is allowed, including for administrators. Uploaded originals and application snapshots are retained; replacing a resume archives its old row. Only a trusted server maintenance process should remove abandoned uploads after checking every resume and application reference. Previously issued signed URLs remain usable until their configured short expiry.

## RPC contracts

All public RPCs require an authenticated session. A rejected call returns `{ "ok": false, "err": "..." }`. Anonymous callers have no execute permission.

- `fn_ss_identity()` returns `{ok,kind,profile?}`. Kind is `member`, `admin`, `legacy` or `unregistered`. Member profile contains `user_id`, `full_name`, `email`, and `status` (`active` or `suspended`); it never includes administrator notes.
- `fn_ss_enroll(p_full_name)` verifies the caller's confirmed email and lack of any legacy mapping, creates their profile once, and returns the same identity response. Repeating enrollment does not rename or reactivate the account.
- `fn_ss_get_my_workspace()` returns `{ok,user_id,resumes,activity,applications,feed_status}`. Resumes are active versions. Activity includes the job record. Applications include immutable job and resume snapshots.
- `fn_ss_discover_jobs(p_limit=200)` returns `{ok,jobs,feed_status}` with up to 1,000 current, explicitly H-1B-sponsoring US jobs. Jobs require a known publication date within 30 days and source verification within 24 hours.
- `fn_ss_save_my_resume(p_file_name,p_storage_path,p_resume_text,p_parsed_profile,p_latex_text,p_replace_id=null)` returns `{ok,resume}`. Upload the unique storage object first. First upload becomes primary; a replacement preserves the previous version and transfers its primary state.
- `fn_ss_set_primary_resume(p_resume_id)` and `fn_ss_update_my_resume(p_resume_id,p_resume_text,p_parsed_profile,p_latex_text)` update only the caller's active resume version.
- `fn_ss_set_job_activity(p_job_id,p_state)` accepts `saved`, `skipped`, or `none`.
- `fn_ss_log_application(p_job_id,p_resume_id,p_resume_text,p_latex_text,p_score,p_status='opened',p_notes='',p_parsed_profile=null)` returns `{ok,id,already,url}`. Opening the employer page records `opened`, not a completed submission. Reopening returns the initial snapshot and preserves progress.
- `fn_ss_update_application_status(p_application_id,p_status)` accepts `opened`, `applied`, `interview`, `offer`, `rejected`, or `withdrawn`.
- `fn_ss_admin_list_members(p_search='',p_offset=0,p_limit=50)` returns `{ok,total,members}`. Each member includes identity, status, timestamps, active resume count, and application count. Search covers name/current email; page size is capped at 100.
- `fn_ss_admin_member_detail(p_user_id)` returns `{ok,member,resumes,activity,applications,audit}`. Member includes private notes. Resumes include archived versions, and audit includes administrator email, action, before/after changes and timestamps. Each successful detail view creates a `view_member` audit event.
- `fn_ss_admin_update_member(p_user_id,p_status,p_admin_notes)` updates status/private notes and records an `update_member` event when either changes. It does not edit resumes, impersonate the member, submit applications, or delete their data.

The admin interface can create a short-lived signed storage URL using the returned `storage_path` and its existing authenticated administrator session. It never needs a browser service key.

## Local verification

These tests create synthetic records and roll them back. Use a fresh disposable PostgreSQL database; never point the bootstrap at production:

```sh
psql "$LOCAL_TEST_DATABASE_URL" -f supabase/tests/bootstrap-local.sql
psql "$LOCAL_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/patches/applydesk-patch10-self-service.sql
psql "$LOCAL_TEST_DATABASE_URL" -f supabase/tests/member-workspace.sql
psql "$LOCAL_TEST_DATABASE_URL" -f supabase/tests/self-service.sql
```

Validated locally with PostgreSQL 18: initial migration, repeat migration, the existing managed-client regression suite, 105 self-service assertions, four expected permission-denial checks, and the immutable application-snapshot trigger. Coverage includes verified signup, metadata spoofing, cross-member isolation, legacy-account separation, administrator inspection/audit/suspension/reactivation, upload ownership, broad-policy storage guards, retained originals, primary replacement, verified job eligibility and application snapshots. Supabase production migrations, email delivery and live storage integration still require rollout verification.
