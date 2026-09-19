-- Disposable local database with patches 10 and 11 only. Synthetic fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function public._ss_pref_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'preference'||i||'@example.test',now(),'{}'
from generate_series(21,23) i;
insert into app_auth_map values('00000000-0000-0000-0000-000000000023','client','legacy-preference-client');
insert into app_job_pool(company,title,source,url,dedup_key,posted_at,date_basis,country_code,sponsorship_status,sponsorship_evidence,sponsorship_evidence_url,status,last_verified_at)
select 'Test employer','Resume preference test','test','https://example.test/jobs/preference-'||i,'preference-'||i,now()-interval '1 day','first_published','US',
'explicit_h1b','We sponsor H-1B visas','https://example.test/jobs/preference-'||i,'active',now()
from generate_series(1,3) i;
select id as pref_job_one from app_job_pool where dedup_key='preference-1' \gset
select id as pref_job_two from app_job_pool where dedup_key='preference-2' \gset
select id as pref_job_three from app_job_pool where dedup_key='preference-3' \gset
select _ss_pref_assert(not has_function_privilege('anon','fn_ss_set_resume_preference(text)','execute'),'anonymous preference changes denied');
select _ss_pref_assert(not has_function_privilege('anon','fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb,text)','execute'),'anonymous new application RPC denied');
select _ss_pref_assert(to_regprocedure('fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb)') is null,'no ambiguous old overload');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select fn_ss_enroll('Preference A');
select _ss_pref_assert(fn_ss_get_my_workspace()->>'application_resume_source'='applydesk','ApplyDesk is default');
insert into storage.objects(bucket_id,name) values
('selfserve-resumes','00000000-0000-0000-0000-000000000021/one/custom.docx'),
('selfserve-resumes','00000000-0000-0000-0000-000000000021/two/replaced.pdf');
select fn_ss_save_my_resume('custom.docx','00000000-0000-0000-0000-000000000021/one/custom.docx',
  'Original resume with documented Python experience.','{"name":"Original","skills":"Python"}','original latex')->'resume'->>'id' as pref_resume \gset
select fn_ss_log_application(:pref_job_one,:pref_resume,'Reviewed ApplyDesk profile for an application.','formatted latex',75,'opened','',
'{"name":"Frozen ApplyDesk","skills":"Python, SQL"}')->>'id' as pref_app_one \gset
select _ss_pref_assert((select resume_snapshot->>'source'='applydesk' from app_selfserve_applications where id=:pref_app_one),'8-argument call gets ApplyDesk source');
select _ss_pref_assert((fn_ss_set_resume_preference('custom')->>'ok')::boolean,'custom choice persisted');
select _ss_pref_assert(fn_ss_get_my_workspace()->>'application_resume_source'='custom','workspace returns saved choice');
select _ss_pref_assert(not (fn_ss_set_resume_preference('forged')->>'ok')::boolean,'invalid choice rejected');
select _ss_pref_assert(not (fn_ss_set_resume_preference(null)->>'ok')::boolean,'null choice rejected');
select _ss_pref_assert(not (fn_ss_log_application(:pref_job_two,:pref_resume,'Must reject stale preference instead of applying wrong source.','text',75,'opened','','{}','applydesk')->>'ok')::boolean,'stale source does not silently override preference');
select fn_ss_log_application(:pref_job_two,:pref_resume,'Edited text must not be exported as custom.','tailored latex',75,'opened','',
'{"name":"Do not export"}','custom')->>'id' as pref_app_two \gset
select _ss_pref_assert((select resume_snapshot->>'source'='custom' from app_selfserve_applications where id=:pref_app_two),'custom application frozen');
select _ss_pref_assert((select score is null from app_selfserve_applications where id=:pref_app_two),'custom does not freeze a score derived from edited profile text');
select _ss_pref_assert((select resume_snapshot->>'storage_path'='00000000-0000-0000-0000-000000000021/one/custom.docx' from app_selfserve_applications where id=:pref_app_two),'custom download points to original object');
select _ss_pref_assert((select not (resume_snapshot ? 'parsed_profile') and not (resume_snapshot ? 'latex_text') and not (resume_snapshot ? 'resume_text') from app_selfserve_applications where id=:pref_app_two),'custom never presents formatted data as the original');
select fn_ss_set_resume_preference('applydesk');
select fn_ss_update_my_resume(:pref_resume,'Edited library profile after application was started.','{"name":"Changed"}','new latex');
select fn_ss_save_my_resume('replaced.pdf','00000000-0000-0000-0000-000000000021/two/replaced.pdf',
'Replacement resume for future applications.','{"name":"Replacement"}','replacement',:pref_resume);
select _ss_pref_assert((select resume_snapshot->'parsed_profile'->>'name'='Frozen ApplyDesk' from app_selfserve_applications where id=:pref_app_one),'ApplyDesk profile frozen after edit and replace');
select _ss_pref_assert((select resume_snapshot->>'file_name'='custom.docx' and resume_snapshot->>'source'='custom' from app_selfserve_applications where id=:pref_app_two),'custom file name/source frozen after replace and preference change');
select _ss_pref_assert((fn_ss_log_application(:pref_job_two,:pref_resume,'Any changed profile must not replace the saved snapshot.','other',75,'opened','','{}','applydesk')->>'already')::boolean,'reopening does not change source');
select _ss_pref_assert((select count(*)=1 from storage.objects where name='00000000-0000-0000-0000-000000000021/one/custom.docx'),'archived custom original remains readable');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000022';
select fn_ss_enroll('Preference B');
select _ss_pref_assert(fn_ss_get_my_workspace()->>'application_resume_source'='applydesk','other member gets independent default');
select fn_ss_set_resume_preference('custom');
select _ss_pref_assert(json_array_length(fn_ss_get_my_workspace()->'applications')=0,'another member cannot read snapshots');
select _ss_pref_assert((select count(*)=0 from storage.objects where bucket_id='selfserve-resumes'),'another member cannot download original');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select _ss_pref_assert(fn_ss_get_my_workspace()->>'application_resume_source'='applydesk','other member preference cannot affect first member');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000023';
select _ss_pref_assert(not (fn_ss_set_resume_preference('custom')->>'ok')::boolean,'managed client cannot change self-service preference');
reset role;
update app_selfserve_members set status='suspended' where user_id='00000000-0000-0000-0000-000000000021';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select _ss_pref_assert(not (fn_ss_set_resume_preference('custom')->>'ok')::boolean,'suspended member cannot change preference');
reset role;
do $$ begin
  begin
    update app_selfserve_applications set resume_snapshot=jsonb_set(resume_snapshot,'{source}','"custom"');
    raise exception 'FAIL: snapshot source mutation permitted';
  exception when raise_exception then
    if sqlerrm<>'Application snapshots are immutable' then raise; end if;
  end;
end $$;
rollback;
\echo 'Application resume preference, original retention, snapshot and account-isolation checks passed.'
