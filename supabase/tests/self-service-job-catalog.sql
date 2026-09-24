-- Disposable local database with patches 10, 11 and 12. Synthetic fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function public._ss_catalog_assert(value boolean,message text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'catalog'||i||'@example.test',
  case when i=35 then null else now() end,'{}' from generate_series(31,35) i;
insert into app_auth_map values('00000000-0000-0000-0000-000000000033','client','legacy-catalog-client');

-- More than the old hard limit, plus every sponsorship classification and dates.
insert into app_job_pool(company,title,source,url,dedup_key,posted_at,date_basis,country_code,sponsorship_status,
  sponsorship_evidence,sponsorship_evidence_url,status,last_verified_at,description,raw_json,search_skills,software_role)
select 'Catalog employer','Software Engineer '||i,'test','https://example.test/jobs/catalog-'||i,'catalog-bulk-'||i,
  now()-interval '1 day','first_published','US',
  (array['explicit_h1b','visa_sponsorship','unknown','not_sponsored'])[(i%4)+1],
  case when i%4=0 then 'We sponsor H-1B visas' else '' end,'https://example.test/jobs/catalog-'||i,'active',now(),
  'Full description: Python application development','{"is_listed":true,"is_prospect":false}',array['Python'],true
from generate_series(1,1005) i;
insert into app_job_pool(company,title,source,url,dedup_key,posted_at,date_basis,country_code,sponsorship_status,
  status,last_verified_at,description,raw_json)
select 'Catalog employer','Date and source fixture '||label,'test',
  case when label='insecure' then 'http://example.test/job' when label='credential-url' then 'https://user:password@example.test/job' else 'https://example.test/jobs/'||label end,
  'catalog-'||label,
  case when label='unknown-date' then null when label='old' then now()-interval '90 days' when label='future-date' then now()+interval '1 hour' else now()-interval '1 day' end,
  case when label='unknown-date' then 'unknown' else 'first_published' end,
  case when label='foreign' then 'CA' else 'US' end,'unknown',
  case when label='closed' then 'closed' when label='status-stale' then 'stale' else 'active' end,
  case when label='stale' then now()-interval '25 hours' when label='future-check' then now()+interval '1 hour' else now() end,
  'Full test description for detail retrieval',
  case when label='expired' then jsonb_build_object('application_deadline',now()-interval '1 minute')
    when label='bad-deadline' then '{"application_deadline":"not a timestamp"}'::jsonb
    when label='relative-deadline' then '{"application_deadline":"tomorrow"}'::jsonb
    when label='unlisted' then '{"is_listed":false}'::jsonb
    when label='prospect' then '{"is_prospect":true}'::jsonb
    when label='valid-deadline' then jsonb_build_object('application_deadline',now()+interval '1 day') else '{}'::jsonb end
from unnest(array['unknown-date','old','valid-deadline','foreign','closed','status-stale','stale','future-check','future-date','expired','bad-deadline','relative-deadline','unlisted','prospect','insecure','credential-url']) label;
select id as catalog_unknown_id from app_job_pool where dedup_key='catalog-unknown-date' \gset
select id as catalog_old_id from app_job_pool where dedup_key='catalog-old' \gset
select _ss_catalog_assert(not has_table_privilege('authenticated','app_job_pool','select'),'no browser catalog table access');
select _ss_catalog_assert(not has_function_privilege('anon','fn_ss_job_catalog(bigint,int)','execute'),'anonymous catalog denied');
select _ss_catalog_assert(not has_function_privilege('anon','fn_ss_job_detail(bigint)','execute'),'anonymous detail denied');
select _ss_catalog_assert(not has_function_privilege('authenticated','fn_ss_job_is_current(app_job_pool)','execute'),'internal eligibility helper hidden');
select _ss_catalog_assert(to_regprocedure('fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb)') is null,'no ambiguous application overload');
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000031';
select fn_ss_enroll('Catalog A');
select _ss_catalog_assert((fn_ss_job_catalog()->>'total')::int=1008,'all current US sponsorship classes and old/unknown dates included');
select _ss_catalog_assert(json_array_length(fn_ss_job_catalog()->'jobs')=250,'default page bounded');
select _ss_catalog_assert(json_array_length(fn_ss_job_catalog(0,99999)->'jobs')=500,'maximum page bounded');
select _ss_catalog_assert((fn_ss_job_catalog()->>'has_more')::boolean,'first page advertises continuation');
select _ss_catalog_assert(not ((fn_ss_job_catalog()->'jobs'->0)::jsonb ? 'description'),'list omits descriptions');
select _ss_catalog_assert(not ((fn_ss_job_catalog()->'jobs'->0)::jsonb ? 'raw_json'),'list omits raw data');
select _ss_catalog_assert((fn_ss_job_catalog()->'jobs'->0->'search_skills')->>0='Python','list has skills');
select _ss_catalog_assert((fn_ss_job_catalog()->'jobs'->0->>'software_role')::boolean,'list has software role evidence');
select _ss_catalog_assert((fn_ss_job_detail(:catalog_unknown_id)->>'ok')::boolean,'detail accepts unknown publication date');
select _ss_catalog_assert((fn_ss_job_detail(:catalog_old_id)->'job'->>'description')='Full test description for detail retrieval','detail supplies full description');
select _ss_catalog_assert(not ((fn_ss_job_detail(:catalog_old_id)->'job')::jsonb ? 'raw_json'),'detail omits raw data');
select _ss_catalog_assert(json_array_length(fn_ss_discover_jobs(2000)->'jobs')=1000,'legacy discover retains bounded shape and recent range');
select _ss_catalog_assert((select count(distinct j->>'sponsorship_status')=4 from json_array_elements(fn_ss_discover_jobs(1000)->'jobs') j),'legacy discover now includes every sponsorship class');
select _ss_catalog_assert(not (fn_ss_job_detail(-1)->>'ok')::boolean,'missing job rejected');
do $$
declare page json; cursor_id bigint:=0; count_rows int:=0; next_id bigint; item json;
begin
  loop
    page:=public.fn_ss_job_catalog(cursor_id,249);
    for item in select value from json_array_elements(page->'jobs') loop
      next_id:=(item->>'id')::bigint;
      if next_id<=cursor_id then raise exception 'FAIL: repeated/out-of-order page row'; end if;
      cursor_id:=next_id; count_rows:=count_rows+1;
    end loop;
    perform _ss_catalog_assert((page->>'next_after_id')::bigint=cursor_id,'cursor is final returned ID');
    exit when not (page->>'has_more')::boolean;
    if count_rows>1100 then raise exception 'FAIL: pagination did not terminate'; end if;
  end loop;
  perform _ss_catalog_assert(count_rows=1008,'keyset pagination retrieves all rows beyond 1000');
  page:=public.fn_ss_job_catalog(cursor_id,249);
  perform _ss_catalog_assert(json_array_length(page->'jobs')=0 and not (page->>'has_more')::boolean,'terminal page empty');
  perform _ss_catalog_assert((page->>'total')::int=1008,'terminal page retains total');
end $$;
insert into storage.objects(bucket_id,name) values('selfserve-resumes','00000000-0000-0000-0000-000000000031/one/resume.docx');
select fn_ss_save_my_resume('resume.docx','00000000-0000-0000-0000-000000000031/one/resume.docx',
  'Original resume describing documented Python development.','{"name":"Catalog A","skills":"Python"}','latex')->'resume'->>'id' as catalog_resume \gset
select fn_ss_log_application(:catalog_unknown_id,:catalog_resume,'Frozen reviewed ApplyDesk resume for this role.','frozen latex',75,'opened','',
  '{"name":"Frozen Catalog A","skills":"Python"}')->>'id' as catalog_application \gset
select _ss_catalog_assert(:'catalog_application'<>'','old 8-argument application call accepts unknown-date nonsponsored listing');
select _ss_catalog_assert((fn_ss_log_application(:catalog_old_id,:catalog_resume,'Frozen reviewed ApplyDesk resume for older current role.','latex',70)->>'ok')::boolean,'older verified listing can start application');
reset role;
-- Verify invalid jobs are rejected consistently by selected detail and application.
create temporary table catalog_bad_ids as select id from app_job_pool where dedup_key like 'catalog-%'
  and dedup_key not like 'catalog-bulk-%' and dedup_key not in ('catalog-unknown-date','catalog-old','catalog-valid-deadline');
grant select on catalog_bad_ids to authenticated;
set role authenticated;
do $$
declare bad_id bigint; resume_id bigint;
begin
  select id into resume_id from app_selfserve_resumes where user_id=auth.uid() and archived_at is null;
  for bad_id in select id from catalog_bad_ids loop
    perform _ss_catalog_assert(not (fn_ss_job_detail(bad_id)->>'ok')::boolean,'invalid detail rejected');
    perform _ss_catalog_assert(not (fn_ss_log_application(bad_id,resume_id,'Real documented development experience.','latex',70)->>'ok')::boolean,'invalid application rejected');
  end loop;
end $$;
select fn_ss_update_my_resume(:catalog_resume,'Changed library profile after opening.','{"name":"Changed"}','changed');
select _ss_catalog_assert((select resume_snapshot->'parsed_profile'->>'name'='Frozen Catalog A' from app_selfserve_applications where id=:catalog_application),'resume snapshot stays frozen after edit');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000032';
select fn_ss_enroll('Catalog B');
select _ss_catalog_assert((fn_ss_job_catalog()->>'ok')::boolean,'independent active member gets public catalog');
select _ss_catalog_assert(json_array_length(fn_ss_get_my_workspace()->'applications')=0,'catalog does not expose another member application');
select _ss_catalog_assert(not (fn_ss_log_application(:catalog_unknown_id,:catalog_resume,'Attempted cross-account resume access.','latex',50)->>'ok')::boolean,'other member resume cannot be used');
select _ss_catalog_assert(not (fn_ss_admin_list_members()->>'ok')::boolean,'catalog does not grant administrator access');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000033';
select _ss_catalog_assert(not (fn_ss_job_catalog()->>'ok')::boolean,'managed client cannot use self-service catalog');
select _ss_catalog_assert(not (fn_ss_job_detail(:catalog_old_id)->>'ok')::boolean,'managed client detail denied');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000034';
select _ss_catalog_assert(not (fn_ss_job_catalog()->>'ok')::boolean,'unenrolled user catalog denied');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000035';
select _ss_catalog_assert(not (fn_ss_job_catalog()->>'ok')::boolean,'unverified user catalog denied');
reset role;
update app_job_pool set status='closed',title='Employer changed title' where id=:catalog_unknown_id;
set role authenticated;
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000031';
select _ss_catalog_assert((fn_ss_log_application(:catalog_unknown_id,:catalog_resume,'Changed text must not replace snapshot.','other',50)->>'already')::boolean,'existing application reopens after closure');
select _ss_catalog_assert((select job_snapshot->>'title'='Date and source fixture unknown-date' from app_selfserve_applications where id=:catalog_application),'job snapshot unchanged after source update');
reset role;
update app_selfserve_members set status='suspended' where user_id='00000000-0000-0000-0000-000000000031';
set role authenticated;
select _ss_catalog_assert(not (fn_ss_job_catalog()->>'ok')::boolean,'suspended member catalog denied');
select _ss_catalog_assert(not (fn_ss_job_detail(:catalog_old_id)->>'ok')::boolean,'suspended member detail denied');
select _ss_catalog_assert(not (fn_ss_log_application(:catalog_old_id,:catalog_resume,'Suspended user cannot reopen an application.','latex',50)->>'ok')::boolean,'suspension still blocks application reopen');
reset role;
rollback;
\echo 'US catalog pagination, sponsorship metadata, eligibility, account isolation and immutable application checks passed.'
