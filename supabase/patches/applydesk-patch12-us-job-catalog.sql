-- ApplyDesk patch 12: current US catalog with factual sponsorship labels.
-- Requires patches 10 and 11. Do not reapply those older patches afterwards.
-- Catalog metadata is paginated; full descriptions are retrieved per selected job.
-- No managed-client functions, account policies, storage rules or table grants change.
begin;

alter table public.app_job_pool
  add column if not exists search_skills text[] not null default '{}',
  add column if not exists software_role boolean not null default false;
create index if not exists app_job_pool_source_board_idx
  on public.app_job_pool(source,source_board,id);
create index if not exists app_job_pool_current_us_idx
  on public.app_job_pool(id) where status='active' and country_code='US';

-- Internal predicate shared by discovery, selected details and new applications.
-- Dates are facts from the provider: unknown/older publication dates remain valid
-- in the current catalog, but future dates and stale source checks never do.
-- Treat malformed deadline values conservatively instead of failing a whole page.
create or replace function public.fn_ss_job_is_current(p_job public.app_job_pool)
returns boolean language plpgsql stable set search_path=public,pg_temp as $$
declare v_deadline timestamptz; v_raw_deadline text;
begin
  if p_job.status is distinct from 'active' or p_job.country_code is distinct from 'US'
    or length(trim(coalesce(p_job.title,'')))=0
    or coalesce(p_job.url,'') !~ '^https://[^/@[:space:]?#]+([/?#][^[:space:]]*)?$'
    or p_job.last_verified_at is null
    or p_job.last_verified_at not between now()-interval '24 hours' and now()
    or (p_job.posted_at is not null and p_job.posted_at>now())
    or p_job.raw_json->>'is_listed'='false'
    or p_job.raw_json->>'is_prospect'='true' then return false; end if;
  v_raw_deadline:=p_job.raw_json->>'application_deadline';
  if v_raw_deadline is not null then
    -- Workers normalize valid provider dates to ISO timestamps. PostgreSQL's
    -- permissive relative-date literals (e.g. tomorrow/infinity) are not dates
    -- accepted by that pipeline and must not revive a malformed source value.
    if v_raw_deadline !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
    begin v_deadline:=v_raw_deadline::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then return false;
    end;
    if v_deadline<=now() then return false; end if;
  end if;
  return true;
end $$;
revoke all on function public.fn_ss_job_is_current(public.app_job_pool) from public,anon,authenticated;

create or replace function public.fn_ss_job_catalog(p_after_id bigint default 0,p_limit int default 250)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=public.fn_ss_active_user_id(); v_after bigint:=greatest(0,coalesce(p_after_id,0));
  v_limit int:=greatest(1,least(coalesce(p_limit,250),500)); v_result json;
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  with eligible as materialized (
    select j.id,j.company,j.title,j.source,j.url,j.posted_at,j.ats_type,j.location,
      j.employment_type,j.salary_text,j.work_mode,j.role_level,j.years_required,
      j.source_board,j.source_job_id,j.date_basis,j.source_updated_at,j.first_seen_at,j.last_seen_at,
      j.last_verified_at,j.status,j.country_code,j.sponsorship_status,j.sponsorship_evidence,j.sponsorship_evidence_url,
      j.search_skills,j.software_role
    from public.app_job_pool j where public.fn_ss_job_is_current(j)
  ), page as (
    select * from eligible where id>v_after order by id limit v_limit
  )
  select json_build_object('ok',true,
    'jobs',(select coalesce(json_agg(p order by p.id),'[]'::json) from page p),
    'total',(select count(*) from eligible),
    'next_after_id',coalesce((select max(id) from page),v_after),
    'has_more',exists(select 1 from eligible where id>coalesce((select max(id) from page),v_after)),
    'feed_status',(select coalesce(json_agg(json_build_object(
      'source',f.source,'source_board',f.source_board,'company',f.company,
      'last_attempt_at',f.last_attempt_at,'last_success_at',f.last_success_at,'status',f.status,
      'jobs_seen',f.jobs_seen,'jobs_eligible',f.jobs_eligible) order by f.company),'[]'::json)
      from public.app_job_feed_status f)
  ) into v_result;
  return v_result;
end $$;

create or replace function public.fn_ss_job_detail(p_job_id bigint)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=public.fn_ss_active_user_id(); v_job public.app_job_pool%rowtype;
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  select * into v_job from public.app_job_pool j where j.id=p_job_id and public.fn_ss_job_is_current(j);
  if not found then return json_build_object('ok',false,'err','This job is unavailable or needs a fresh source verification'); end if;
  return json_build_object('ok',true,'job',to_jsonb(v_job)-'raw_json');
end $$;

-- Existing callers retain their parameter and response shape and 30-day range.
-- Sponsorship is descriptive metadata, no longer an eligibility requirement.
create or replace function public.fn_ss_discover_jobs(p_limit int default 200)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=public.fn_ss_active_user_id();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  return json_build_object('ok',true,'jobs',(
    select coalesce(json_agg(x order by x.posted_at desc,x.id desc),'[]'::json) from (
      select j.id,j.company,j.title,j.source,j.url,j.posted_at,j.ats_type,j.location,j.description,
        j.employment_type,j.salary_text,j.work_mode,j.role_level,j.years_required,
        j.source_board,j.source_job_id,j.date_basis,j.source_updated_at,j.first_seen_at,j.last_seen_at,
        j.last_verified_at,j.status,j.country_code,j.sponsorship_status,j.sponsorship_evidence,j.sponsorship_evidence_url,
        j.search_skills,j.software_role
      from public.app_job_pool j where public.fn_ss_job_is_current(j)
        and j.date_basis<>'unknown' and j.posted_at between now()-interval '30 days' and now()
      order by j.posted_at desc,j.id desc limit greatest(1,least(coalesce(p_limit,200),1000))
    ) x
  ),'feed_status',(
    select coalesce(json_agg(json_build_object('source',f.source,'source_board',f.source_board,'company',f.company,
      'last_attempt_at',f.last_attempt_at,'last_success_at',f.last_success_at,'status',f.status,
      'jobs_seen',f.jobs_seen,'jobs_eligible',f.jobs_eligible) order by f.company),'[]'::json)
    from public.app_job_feed_status f
  ));
end $$;

create or replace function public.fn_ss_log_application(
  p_job_id bigint,p_resume_id bigint,p_resume_text text,p_latex_text text,p_score numeric,
  p_status text default 'opened',p_notes text default '',p_parsed_profile jsonb default null,
  p_resume_source text default null
)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member(); v_resume public.app_selfserve_resumes%rowtype; v_job public.app_job_pool%rowtype; v_id bigint; v_existing_url text; v_source text;
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  -- Reopening always keeps the original source, content and progress, even if preferences changed.
  select id,job_snapshot->>'url' into v_id,v_existing_url from public.app_selfserve_applications where user_id=v_user and job_id=p_job_id;
  if found then return json_build_object('ok',true,'id',v_id,'already',true,'url',v_existing_url); end if;
  select application_resume_source into v_source from public.app_selfserve_members where user_id=v_user;
  if p_resume_source is not null and p_resume_source is distinct from v_source then
    return json_build_object('ok',false,'err','Your resume preference changed. Refresh your workspace before applying.');
  end if;
  if p_status is null or p_status not in ('opened','applied') or p_score<0 or p_score>100
    or length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or length(coalesce(p_latex_text,''))>500000 or length(coalesce(p_notes,''))>10000
    or (p_parsed_profile is not null and (jsonb_typeof(p_parsed_profile)<>'object' or octet_length(p_parsed_profile::text)>500000)) then
    return json_build_object('ok',false,'err','Invalid application snapshot');
  end if;
  select * into v_resume from public.app_selfserve_resumes where id=p_resume_id and user_id=v_user and archived_at is null;
  if not found then return json_build_object('ok',false,'err','Resume not found'); end if;
  select * into v_job from public.app_job_pool j where j.id=p_job_id and public.fn_ss_job_is_current(j);
  if not found then return json_build_object('ok',false,'err','This job needs a fresh source verification before applying'); end if;
  insert into public.app_selfserve_applications(user_id,job_id,resume_id,job_snapshot,resume_snapshot,score,status,notes,applied_at)
  values (v_user,p_job_id,p_resume_id,
    to_jsonb(v_job)-'raw_json',
    jsonb_build_object('source',v_source,'resume_id',v_resume.id,'file_name',v_resume.file_name,'storage_path',v_resume.storage_path)
      || case when v_source='applydesk' then jsonb_build_object(
        'resume_text',p_resume_text,'latex_text',coalesce(p_latex_text,''),
        'parsed_profile',coalesce(p_parsed_profile,v_resume.parsed_profile)) else '{}'::jsonb end,
    case when v_source='applydesk' then p_score else null end,p_status,coalesce(p_notes,''),case when p_status='applied' then now() end)
    returning id into v_id;
  return json_build_object('ok',true,'id',v_id,'already',false,'url',v_job.url);
end $$;


revoke all on function public.fn_ss_job_catalog(bigint,int),public.fn_ss_job_detail(bigint),
  public.fn_ss_discover_jobs(int),public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.fn_ss_job_catalog(bigint,int),public.fn_ss_job_detail(bigint),
  public.fn_ss_discover_jobs(int),public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb,text)
  to authenticated;
notify pgrst,'reload schema';
commit;
