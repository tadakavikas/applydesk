-- ApplyDesk patch 11: persistent application resume preference and immutable source.
-- Requires patch 10. Apply after patch 10; do not reapply patch 10 afterwards.
-- Existing member/application data and legacy managed-client access are preserved.
-- Old snapshots have no source key and retain their existing ApplyDesk export behavior.
begin;
alter table public.app_selfserve_members add column if not exists application_resume_source text
  not null default 'applydesk' check (application_resume_source in ('applydesk','custom'));

create or replace function public.fn_ss_set_resume_preference(p_source text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if p_source is null or p_source not in ('applydesk','custom') then
    return json_build_object('ok',false,'err','Choose ApplyDesk resume or custom original');
  end if;
  update public.app_selfserve_members set application_resume_source=p_source,updated_at=now() where user_id=v_user;
  return json_build_object('ok',true,'application_resume_source',p_source);
end $$;

-- A single function with an optional ninth argument also serves existing eight-argument callers.
-- The member lock serializes preference changes and application creation.
drop function if exists public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb);
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
  select * into v_job from public.app_job_pool where id=p_job_id and status='active' and country_code='US'
    and sponsorship_status='explicit_h1b' and coalesce(sponsorship_evidence,'')<>''
    and sponsorship_evidence_url ~ '^https://' and url ~ '^https://'
    and date_basis<>'unknown' and posted_at between now()-interval '30 days' and now()
    and last_verified_at between now()-interval '24 hours' and now();
  if not found then return json_build_object('ok',false,'err','This job needs a fresh H-1B/source verification before applying'); end if;
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

create or replace function public.fn_ss_get_my_workspace()
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_active_user_id();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  return json_build_object('ok',true,'user_id',v_user,
    'application_resume_source',(select application_resume_source from public.app_selfserve_members where user_id=v_user),
    'resumes',(select coalesce(json_agg(r order by r.is_primary desc,r.created_at desc),'[]'::json)
      from public.app_selfserve_resumes r where r.user_id=v_user and r.archived_at is null),
    'activity',(select coalesce(json_agg(x order by x.updated_at desc),'[]'::json) from (
      select a.*,to_jsonb(j)-'raw_json' as job from public.app_selfserve_job_activity a
      join public.app_job_pool j on j.id=a.job_id where a.user_id=v_user
    ) x),
    'applications',(select coalesce(json_agg(x order by x.created_at desc),'[]'::json) from (
      select a.*,a.job_snapshot->>'company' as company,a.job_snapshot->>'title' as title,a.job_snapshot->>'url' as url,
        a.resume_snapshot->>'file_name' as file_name,a.resume_snapshot->>'resume_text' as resume_text,
        a.resume_snapshot->>'latex_text' as latex_text
      from public.app_selfserve_applications a where a.user_id=v_user
    ) x),
    'feed_status',(select coalesce(json_agg(json_build_object('source',f.source,'source_board',f.source_board,
      'company',f.company,'last_success_at',f.last_success_at,'status',f.status,
      'jobs_seen',f.jobs_seen,'jobs_eligible',f.jobs_eligible) order by f.company),'[]'::json) from public.app_job_feed_status f)
  );
end $$;

revoke all on function public.fn_ss_set_resume_preference(text),
  public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.fn_ss_set_resume_preference(text),
  public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb,text)
  to authenticated;
notify pgrst,'reload schema';
commit;
