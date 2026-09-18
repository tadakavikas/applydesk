-- Run against bootstrap-local.sql's disposable DB. Fixture data rolls back.
\set ON_ERROR_STOP on
begin;
create function public._workspace_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;

insert into auth.users(id) values
 ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000003'),('00000000-0000-0000-0000-000000000004');
insert into app_clients values('client-a','Client A'),('client-b','Client B');
insert into app_recruiters values('recruiter-a',array['client-a']);
insert into app_auth_map values
 ('00000000-0000-0000-0000-000000000001','client','client-a'),
 ('00000000-0000-0000-0000-000000000002','client','client-b'),
 ('00000000-0000-0000-0000-000000000003','recruiter','recruiter-a');

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

select _workspace_assert(not has_function_privilege('anon','fn_a_get_my_workspace()','execute'),'anon RPC rejected');
select _workspace_assert(not has_function_privilege('authenticated','fn_a_workspace_sync_profile(text)','execute'),'private profile writer rejected');
select _workspace_assert(not has_table_privilege('authenticated','app_member_resumes','insert'),'direct resume insert forbidden');
select _workspace_assert(not has_table_privilege('authenticated','app_member_applications','update'),'direct snapshot update forbidden');

set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select _workspace_assert((fn_a_get_my_workspace()->>'ok')::boolean,'mapped client can access workspace');
select _workspace_assert(json_array_length(fn_a_discover_jobs()->'jobs')=1,'discovery excludes unknown date, stale, closed, old and generic visa jobs');
insert into storage.objects(bucket_id,name) values
 ('client-resumes','00000000-0000-0000-0000-000000000001/one/resume.pdf'),
 ('client-resumes','00000000-0000-0000-0000-000000000001/two/resume.docx'),
 ('client-resumes','00000000-0000-0000-0000-000000000001/three/replacement.pdf');
select (fn_a_save_my_resume('resume.pdf','00000000-0000-0000-0000-000000000001/one/resume.pdf',
 'Original resume with Python and SQL experience.', '{"name":"Client A","skills":["Python","SQL"]}','Original latex')->'resume'->>'id') as resume_one \gset
select (fn_a_save_my_resume('resume.docx','00000000-0000-0000-0000-000000000001/two/resume.docx',
 'Second resume with Java and cloud experience.', '{"name":"Client A","skills":["Java"]}','Second latex')->'resume'->>'id') as resume_two \gset
select _workspace_assert((select count(*)=1 from app_member_resumes where is_primary),'exactly one primary after add');
select _workspace_assert((select is_primary from app_member_resumes where id=:resume_one),'first upload remains primary');
select _workspace_assert((fn_a_set_primary_resume(:resume_two)->>'ok')::boolean,'set primary succeeds');
select _workspace_assert((select is_primary from app_member_resumes where id=:resume_two),'selected primary applied');
select _workspace_assert((fn_a_set_job_activity(:job_id,'saved')->>'ok')::boolean,'save job');
select _workspace_assert((fn_a_get_my_workspace()->'activity'->0->'job'->>'title')='eligible','saved activity includes job');
select _workspace_assert(not (fn_a_log_application(:stale_id,:resume_two,'My accurate tailored resume text.','Latex',75)->>'ok')::boolean,'stale job cannot start');
select (fn_a_log_application(:job_id,:resume_two,'My accurate tailored resume text.','Tailored latex',75,'opened','',
 '{"name":"Client A","skills":["Java"]}')) as logged_result \gset
select (:'logged_result'::json->>'id') as app_id \gset
select _workspace_assert((:'logged_result'::json->>'url')='https://example.test/jobs/eligible','first open returns verified employer URL');
select _workspace_assert((select status='opened' and applied_at is null from app_member_applications where id=:app_id),'opening never claims submission');
select _workspace_assert((fn_a_log_application(:job_id,:resume_one,'Different resume must not overwrite.','Other latex',99)->>'already')::boolean,'repeat open idempotent');
select _workspace_assert((fn_a_log_application(:job_id,:resume_one,'Different resume must not overwrite.','Other latex',99)->>'url')='https://example.test/jobs/eligible','repeat open returns snapshot employer URL');
select _workspace_assert((fn_a_update_my_resume(:resume_two,'Changed base resume after starting application.', '{"name":"Edited"}','Changed latex')->>'ok')::boolean,'edit source resume');
select _workspace_assert((select resume_snapshot->>'resume_text'='My accurate tailored resume text.' from app_member_applications where id=:app_id),'source edit preserves snapshot');
select (fn_a_save_my_resume('replacement.pdf','00000000-0000-0000-0000-000000000001/three/replacement.pdf',
 'Replacement resume with verified experience.', '{"name":"Client A"}','Replacement latex',:resume_two)->'resume'->>'id') as resume_three \gset
select _workspace_assert((select archived_at is not null and not is_primary from app_member_resumes where id=:resume_two),'replaced version archived');
select _workspace_assert((select is_primary from app_member_resumes where id=:resume_three),'replace transfers primary');
select _workspace_assert(json_array_length(fn_a_get_my_workspace()->'resumes')=2,'active library includes added and replaced resumes');
delete from storage.objects where name='00000000-0000-0000-0000-000000000001/two/resume.docx';
select _workspace_assert((select count(*)=1 from storage.objects where name='00000000-0000-0000-0000-000000000001/two/resume.docx'),'archived original cannot be deleted');
select _workspace_assert((fn_a_update_application_status(:app_id,'applied')->>'ok')::boolean,'member can report applied');
select _workspace_assert((select status='applied' and applied_at is not null from app_member_applications where id=:app_id),'reported applied records timestamp');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select _workspace_assert((select count(*)=0 from app_member_resumes),'other client resumes hidden');
select _workspace_assert((select count(*)=0 from app_member_applications),'other client snapshots hidden');
select _workspace_assert((select count(*)=0 from storage.objects),'other client storage hidden');
select _workspace_assert(not (fn_a_set_primary_resume(:resume_one)->>'ok')::boolean,'cannot select other client resume');
select _workspace_assert(not (fn_a_update_my_resume(:resume_one,'Tampering with other client resume.','{}','x')->>'ok')::boolean,'cannot edit other client resume');
select _workspace_assert(not (fn_a_update_application_status(:app_id,'offer')->>'ok')::boolean,'cannot modify other client application');
select _workspace_assert(not (fn_a_log_application(:job_id,:resume_one,'Tampering with other client resume.','x',99)->>'ok')::boolean,'cannot snapshot other client resume');
select _workspace_assert(not (fn_a_save_my_resume('resume.pdf','00000000-0000-0000-0000-000000000001/one/resume.pdf',
 'Tampering with other client upload.','{}','x')->>'ok')::boolean,'cannot register other client upload');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select _workspace_assert((select count(*)=3 from app_member_resumes),'assigned recruiter can read resume versions');
select _workspace_assert((select count(*)=1 from app_member_applications),'assigned recruiter can read application snapshot');
select _workspace_assert((select count(*)=3 from storage.objects),'assigned recruiter can access private originals');
select _workspace_assert(not (fn_a_set_primary_resume(:resume_one)->>'ok')::boolean,'recruiter cannot mutate self-service primary');

set request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
select _workspace_assert(not (fn_a_get_my_workspace()->>'ok')::boolean,'unmapped auth user denied');
select _workspace_assert((select count(*)=0 from app_member_resumes),'unmapped auth user cannot read resumes');

reset role;
do $$ begin
  begin
    update app_member_applications set resume_snapshot='{}';
    raise exception 'FAIL: snapshot mutation permitted';
  exception when raise_exception then
    if sqlerrm<>'Application snapshots are immutable' then raise; end if;
  end;
end $$;
rollback;
\echo 'Member workspace security and lifecycle tests passed.'
