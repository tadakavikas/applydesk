-- Disposable local PostgreSQL only. Requires bootstrap-local.sql; all fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function public._ss_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
create function public._ss_expect_denied(statement text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when insufficient_privilege then return; end;
  raise exception 'FAIL: unauthorized statement succeeded: %',statement;
end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'member'||i||'@example.test',
 case when i=8 then null else now() end,case when i=9 then '{"role":"admin","is_admin":true}'::jsonb else '{}'::jsonb end
from generate_series(1,9) i;
insert into app_clients values('legacy-client','Managed client');
insert into app_recruiters values('recruiter-a',array['legacy-client']);
insert into app_auth_map values
 ('00000000-0000-0000-0000-000000000003','recruiter','recruiter-a'),
 ('00000000-0000-0000-0000-000000000005','admin','admin-a'),
 ('00000000-0000-0000-0000-000000000006','client','legacy-client'),
 ('00000000-0000-0000-0000-000000000007','manager','manager-a');
insert into app_job_pool(company,title,source,url,dedup_key,posted_at,date_basis,country_code,sponsorship_status,sponsorship_evidence,sponsorship_evidence_url,status,last_verified_at)
select 'Test employer',label,'test','https://example.test/jobs/'||label,label,
 case when label='unknown-date' then null when label='old' then now()-interval '40 days' else now()-interval '1 day' end,
 case when label='unknown-date' then 'unknown' else 'first_published' end,'US',
 case when label='generic-visa' then 'visa_sponsorship' else 'explicit_h1b' end,
 'We sponsor H-1B visas','https://example.test/jobs/'||label,
 case when label='closed' then 'closed' else 'active' end,
 case when label='stale' then now()-interval '25 hours' else now() end
from unnest(array['eligible','unknown-date','old','generic-visa','closed','stale']) label;
select id as job_id from app_job_pool where dedup_key='eligible' \gset
select id as stale_id from app_job_pool where dedup_key='stale' \gset
select _ss_assert(not has_function_privilege('anon','fn_ss_identity()','execute'),'anonymous identity RPC denied');
select _ss_assert(not has_function_privilege('anon','fn_ss_enroll(text)','execute'),'anonymous enroll RPC denied');
select _ss_assert(not has_function_privilege('authenticated','fn_ss_lock_member()','execute'),'private lock helper denied');
select _ss_assert(not has_table_privilege('authenticated','app_selfserve_members','insert'),'cannot directly enroll or set role');
select _ss_assert(not has_table_privilege('authenticated','app_selfserve_members','update'),'cannot directly unsuspend or change admin notes');
select _ss_assert(not has_table_privilege('authenticated','app_selfserve_resumes','insert'),'direct resume insert forbidden');
select _ss_assert(not has_table_privilege('authenticated','app_selfserve_applications','update'),'direct snapshot updates forbidden');
select _ss_assert(not has_table_privilege('authenticated','app_selfserve_admin_audit','insert'),'audit events cannot be forged');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select _ss_assert((fn_ss_enroll('Self-service A')->>'kind')='member','verified signup enrolls');
select _ss_assert((fn_ss_enroll('Renamed attempt')->'profile'->>'full_name')='Self-service A','enrollment is idempotent without renaming');
select _ss_assert((fn_ss_get_my_workspace()->>'ok')::boolean,'new member can access workspace');
select _ss_assert(not (fn_a_get_my_workspace()->>'ok')::boolean,'self-service member cannot use managed client workspace');
select _ss_assert((select count(*)=0 from app_selfserve_members),'admin notes table is hidden from member');
select _ss_assert(json_array_length(fn_ss_discover_jobs()->'jobs')=1,'discovery excludes unknown date, stale, closed, old and generic visa jobs');
insert into storage.objects(bucket_id,name) values
 ('selfserve-resumes','00000000-0000-0000-0000-000000000001/one/resume.pdf'),
 ('selfserve-resumes','00000000-0000-0000-0000-000000000001/two/resume.docx'),
 ('selfserve-resumes','00000000-0000-0000-0000-000000000001/three/replacement.pdf');
select (fn_ss_save_my_resume('resume.pdf','00000000-0000-0000-0000-000000000001/one/resume.pdf',
 'Original resume with Python and SQL experience.', '{"name":"Client A","skills":["Python","SQL"]}','Original latex')->'resume'->>'id') as resume_one \gset
select (fn_ss_save_my_resume('resume.docx','00000000-0000-0000-0000-000000000001/two/resume.docx',
 'Second resume with Java and cloud experience.', '{"name":"Client A","skills":["Java"]}','Second latex')->'resume'->>'id') as resume_two \gset
select _ss_assert((select count(*)=1 from app_selfserve_resumes where is_primary),'exactly one primary after add');
select _ss_assert((select is_primary from app_selfserve_resumes where id=:resume_one),'first upload remains primary');
select _ss_assert((fn_ss_set_primary_resume(:resume_two)->>'ok')::boolean,'set primary succeeds');
select _ss_assert((select is_primary from app_selfserve_resumes where id=:resume_two),'selected primary applied');
select _ss_assert((fn_ss_set_job_activity(:job_id,'saved')->>'ok')::boolean,'save job');
select _ss_assert((fn_ss_get_my_workspace()->'activity'->0->'job'->>'title')='eligible','saved activity includes job');
select _ss_assert(not (fn_ss_log_application(:stale_id,:resume_two,'My accurate tailored resume text.','Latex',75)->>'ok')::boolean,'stale job cannot start');
select (fn_ss_log_application(:job_id,:resume_two,'My accurate tailored resume text.','Tailored latex',75,'opened','',
 '{"name":"Client A","skills":["Java"]}')) as logged_result \gset
select (:'logged_result'::json->>'id') as app_id \gset
select _ss_assert((:'logged_result'::json->>'url')='https://example.test/jobs/eligible','first open returns verified employer URL');
select _ss_assert((select status='opened' and applied_at is null from app_selfserve_applications where id=:app_id),'opening never claims submission');
select _ss_assert((fn_ss_log_application(:job_id,:resume_one,'Different resume must not overwrite.','Other latex',99)->>'already')::boolean,'repeat open idempotent');
select _ss_assert((fn_ss_log_application(:job_id,:resume_one,'Different resume must not overwrite.','Other latex',99)->>'url')='https://example.test/jobs/eligible','repeat open returns snapshot employer URL');
select _ss_assert((fn_ss_update_my_resume(:resume_two,'Changed base resume after starting application.', '{"name":"Edited"}','Changed latex')->>'ok')::boolean,'edit source resume');
select _ss_assert((select resume_snapshot->>'resume_text'='My accurate tailored resume text.' from app_selfserve_applications where id=:app_id),'source edit preserves snapshot');
select (fn_ss_save_my_resume('replacement.pdf','00000000-0000-0000-0000-000000000001/three/replacement.pdf',
 'Replacement resume with verified experience.', '{"name":"Client A"}','Replacement latex',:resume_two)->'resume'->>'id') as resume_three \gset
select _ss_assert((select archived_at is not null and not is_primary from app_selfserve_resumes where id=:resume_two),'replaced version archived');
select _ss_assert((select is_primary from app_selfserve_resumes where id=:resume_three),'replace transfers primary');
select _ss_assert(json_array_length(fn_ss_get_my_workspace()->'resumes')=2,'active library includes added and replaced resumes');
delete from storage.objects where name='00000000-0000-0000-0000-000000000001/two/resume.docx';
select _ss_assert((select count(*)=1 from storage.objects where name='00000000-0000-0000-0000-000000000001/two/resume.docx'),'archived original cannot be deleted');
select _ss_assert((fn_ss_update_application_status(:app_id,'applied')->>'ok')::boolean,'member can report applied');
select _ss_assert((select status='applied' and applied_at is not null from app_selfserve_applications where id=:app_id),'reported applied records timestamp');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select _ss_assert((fn_ss_enroll('Self-service B')->>'kind')='member','second member enrolls independently');
select _ss_assert((select count(*)=0 from app_selfserve_resumes),'other client resumes hidden');
select _ss_assert((select count(*)=0 from app_selfserve_applications),'other client snapshots hidden');
select _ss_assert((select count(*)=0 from storage.objects),'other client storage hidden');
select _ss_assert(not (fn_ss_set_primary_resume(:resume_one)->>'ok')::boolean,'cannot select other client resume');
select _ss_assert(not (fn_ss_update_my_resume(:resume_one,'Tampering with other client resume.','{}','x')->>'ok')::boolean,'cannot edit other client resume');
select _ss_assert(not (fn_ss_update_application_status(:app_id,'offer')->>'ok')::boolean,'cannot modify other client application');
select _ss_assert(not (fn_ss_log_application(:job_id,:resume_one,'Tampering with other client resume.','x',99)->>'ok')::boolean,'cannot snapshot other client resume');
select _ss_assert(not (fn_ss_save_my_resume('resume.pdf','00000000-0000-0000-0000-000000000001/one/resume.pdf',
 'Tampering with other client upload.','{}','x')->>'ok')::boolean,'cannot register other client upload');

select _ss_assert(not (fn_ss_admin_list_members()->>'ok')::boolean,'members cannot list other members');
select _ss_assert(not (fn_ss_admin_member_detail('00000000-0000-0000-0000-000000000001')->>'ok')::boolean,'members cannot read other member admin detail');
select _ss_expect_denied($$insert into storage.objects(bucket_id,name) values('selfserve-resumes','00000000-0000-0000-0000-000000000001/stolen/resume.pdf')$$);

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select _ss_assert((fn_ss_identity()->>'kind')='legacy','recruiter identity is legacy');
select _ss_assert(not (fn_ss_enroll('Recruiter')->>'ok')::boolean,'recruiter cannot enroll as member');
select _ss_assert((select count(*)=0 from app_selfserve_resumes),'recruiter cannot read self-service resumes');
select _ss_assert((select count(*)=0 from app_selfserve_applications),'recruiter cannot read self-service applications');
select _ss_assert((select count(*)=0 from storage.objects where bucket_id='selfserve-resumes'),'recruiter cannot read self-service originals');
select _ss_assert(not (fn_ss_admin_list_members()->>'ok')::boolean,'recruiter cannot list members');
select _ss_assert(not (fn_ss_admin_update_member('00000000-0000-0000-0000-000000000001','active','')->>'ok')::boolean,'recruiter cannot change member');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000007';
select _ss_assert((fn_ss_identity()->>'kind')='legacy','manager identity is legacy');
select _ss_assert(not (fn_ss_admin_list_members()->>'ok')::boolean,'manager cannot list members');
select _ss_assert((select count(*)=0 from app_selfserve_resumes),'manager cannot read self-service resumes');
select _ss_assert(not (fn_ss_enroll('Manager')->>'ok')::boolean,'manager cannot enroll');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select _ss_assert((fn_ss_identity()->>'kind')='legacy','managed client remains legacy');
select _ss_assert(not (fn_ss_enroll('Managed Client')->>'ok')::boolean,'managed client cannot enroll');
select _ss_assert(not (fn_ss_get_my_workspace()->>'ok')::boolean,'managed client cannot use self-service workspace');
select _ss_assert((fn_a_get_my_workspace()->>'ok')::boolean,'managed client keeps original workspace access');
select _ss_assert((select count(*)=0 from app_selfserve_resumes),'managed client cannot read self-service resumes');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
select _ss_assert((fn_ss_identity()->>'kind')='unregistered','unregistered user has explicit identity');
select _ss_assert(not (fn_ss_get_my_workspace()->>'ok')::boolean,'unregistered user has no workspace');
select _ss_assert(not (fn_ss_enroll('x')->>'ok')::boolean,'blank or short name rejected');
select _ss_expect_denied($$insert into storage.objects(bucket_id,name) values('selfserve-resumes','00000000-0000-0000-0000-000000000004/one/resume.pdf')$$);

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
select _ss_assert(not (fn_ss_enroll('Unverified User')->>'ok')::boolean,'unverified email cannot enroll');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000009';
select _ss_assert((fn_ss_identity()->>'kind')='unregistered','metadata cannot forge administrator identity');
select _ss_assert((fn_ss_enroll('Forged Metadata')->>'kind')='member','metadata only permits normal member enrollment');
select _ss_assert(not (fn_ss_admin_list_members()->>'ok')::boolean,'metadata does not grant administrator RPC access');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
select _ss_assert((fn_ss_identity()->>'kind')='admin','trusted mapped admin recognized');
select _ss_assert(not (fn_ss_enroll('Admin')->>'ok')::boolean,'administrator cannot enroll as member');
select _ss_assert((fn_ss_admin_list_members()->>'total')::int=3,'admin lists exactly independent signups');
select _ss_assert(json_array_length(fn_ss_admin_list_members('',0,1)->'members')=1,'member list pagination bounded');
select _ss_assert((fn_ss_admin_list_members('SELF-SERVICE A')->>'total')::int=1,'admin name search case insensitive');
select _ss_assert((fn_ss_admin_list_members('member2@')->>'total')::int=1,'admin search uses current auth email');
select _ss_assert(json_array_length(fn_ss_admin_member_detail('00000000-0000-0000-0000-000000000001')->'resumes')=3,'admin sees active and archived resume versions');
select _ss_assert(json_array_length(fn_ss_admin_member_detail('00000000-0000-0000-0000-000000000001')->'activity')=1,'admin sees saved job state');
select _ss_assert(json_array_length(fn_ss_admin_member_detail('00000000-0000-0000-0000-000000000001')->'applications')=1,'admin sees application snapshots');
select _ss_assert((select count(*)=3 from storage.objects where bucket_id='selfserve-resumes'),'admin can read registered originals');
select _ss_assert((select count(*)=3 from app_selfserve_admin_audit where action='view_member'),'admin detail views audited');
select _ss_assert(not (fn_ss_admin_member_detail('00000000-0000-0000-0000-000000000006')->>'ok')::boolean,'admin self-service detail does not include legacy client');
select _ss_assert((fn_ss_admin_update_member('00000000-0000-0000-0000-000000000001','suspended','Internal admin note')->>'ok')::boolean,'admin can suspend member');
select _ss_assert(not (fn_ss_admin_update_member('00000000-0000-0000-0000-000000000001','admin','')->>'ok')::boolean,'membership status cannot become a role');
select _ss_assert((select count(*)=1 from app_selfserve_admin_audit where action='update_member'),'administrative changes are audited');
select _ss_assert((select details->'before'->>'status'='active' and details->'after'->>'status'='suspended' from app_selfserve_admin_audit where action='update_member'),'audit captures before and after status');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select _ss_assert((fn_ss_identity()->'profile'->>'status')='suspended','identity communicates suspended account');
select _ss_assert((fn_ss_enroll('Trying to reactivate')->'profile'->>'status')='suspended','repeated enrollment never reactivates member');
select _ss_assert(not (fn_ss_get_my_workspace()->>'ok')::boolean,'suspended member workspace blocked');
select _ss_assert(not (fn_ss_discover_jobs()->>'ok')::boolean,'suspended member jobs blocked');
select _ss_assert(not (fn_ss_set_job_activity(:job_id,'skipped')->>'ok')::boolean,'suspended member activity blocked');
select _ss_assert(not (fn_ss_set_primary_resume(:resume_one)->>'ok')::boolean,'suspended member primary change blocked');
select _ss_assert(not (fn_ss_update_application_status(:app_id,'offer')->>'ok')::boolean,'suspended member application changes blocked');
select _ss_assert((select count(*)=0 from app_selfserve_resumes),'suspended member direct resume reads blocked');
select _ss_assert((select count(*)=0 from app_selfserve_admin_audit),'members cannot read admin audit');
select _ss_assert((select count(*)=0 from storage.objects where bucket_id='selfserve-resumes'),'suspended member original downloads blocked');
select _ss_expect_denied($$insert into storage.objects(bucket_id,name) values('selfserve-resumes','00000000-0000-0000-0000-000000000001/suspended/resume.pdf')$$);

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000005';
select _ss_assert((fn_ss_admin_update_member('00000000-0000-0000-0000-000000000001','active','Internal admin note')->>'ok')::boolean,'admin can restore access');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select _ss_assert((fn_ss_get_my_workspace()->>'ok')::boolean,'restored member retains workspace');
select _ss_assert(not ((fn_ss_identity()->'profile')::jsonb ? 'admin_notes'),'member profile excludes admin notes');

reset role;
-- Pre-existing permissive storage rules must not override bucket isolation.
create policy _ss_test_broad_storage on storage.objects for all to authenticated using(true) with check(true);
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select _ss_assert((select count(*)=0 from storage.objects where bucket_id='selfserve-resumes'),'restrictive read guard survives a broad storage policy');
select _ss_expect_denied($$insert into storage.objects(bucket_id,name) values('selfserve-resumes','00000000-0000-0000-0000-000000000001/forbidden/resume.pdf')$$);
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update storage.objects set name='changed' where bucket_id='selfserve-resumes';
delete from storage.objects where bucket_id='selfserve-resumes';
select _ss_assert((select count(*)=3 from storage.objects where bucket_id='selfserve-resumes'),'restrictive guards preserve originals against broad policy');
reset role;
select _ss_assert((select count(*)=1 from app_clients),'enrollment never creates managed clients');
select _ss_assert((select count(*)=4 from app_auth_map),'enrollment never creates legacy auth mappings');
select _ss_assert((select count(*)=0 from app_member_resumes),'self-service never writes managed-client resume table');
select _ss_assert((select count(*)=0 from app_member_applications),'self-service never writes managed-client application table');
select _ss_assert((select count(*)=0 from app_copilot_profiles),'self-service never writes legacy copilot profile');
do $$ begin
  begin
    update app_selfserve_applications set resume_snapshot='{}';
    raise exception 'FAIL: snapshot mutation permitted';
  exception when raise_exception then
    if sqlerrm<>'Application snapshots are immutable' then raise; end if;
  end;
end $$;
-- If an account is later assigned a legacy role, self-service access stops.
insert into app_auth_map values('00000000-0000-0000-0000-000000000001','client','legacy-client');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select _ss_assert((fn_ss_identity()->>'kind')='legacy','legacy mapping takes precedence over member profile');
select _ss_assert(not (fn_ss_get_my_workspace()->>'ok')::boolean,'new legacy mapping blocks old self-service data access');
reset role;
rollback;
\echo 'Self-service isolation, enrollment, admin access, suspension and lifecycle tests passed.'
