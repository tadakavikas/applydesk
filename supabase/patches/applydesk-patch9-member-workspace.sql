-- ApplyDesk patch 9: authenticated member workspace, private resume versions,
-- and a source-verified H-1B feed. Apply AFTER patches 5, 7, and 8.
-- This migration does not import users, change old portal RPCs, or submit jobs.
-- Run in a reviewed Supabase SQL Editor session; never with a browser key.
begin;

alter table public.app_job_pool
  add column if not exists source_board text,
  add column if not exists source_job_id text,
  add column if not exists date_basis text not null default 'unknown',
  add column if not exists source_updated_at timestamptz,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists status text not null default 'stale',
  add column if not exists country_code text,
  add column if not exists sponsorship_status text not null default 'unknown',
  add column if not exists sponsorship_evidence text,
  add column if not exists sponsorship_evidence_url text;

-- Constraints deliberately accept unknown evidence. Unknown is never presented
-- as verified H-1B eligibility in the member discovery RPC.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='app_job_pool_date_basis_check' and conrelid='public.app_job_pool'::regclass) then
    alter table public.app_job_pool add constraint app_job_pool_date_basis_check
      check (date_basis in ('first_published','last_published','provider_created','unknown'));
  end if;
  if not exists (select 1 from pg_constraint where conname='app_job_pool_status_check' and conrelid='public.app_job_pool'::regclass) then
    alter table public.app_job_pool add constraint app_job_pool_status_check check (status in ('active','closed','stale'));
  end if;
  if not exists (select 1 from pg_constraint where conname='app_job_pool_sponsorship_check' and conrelid='public.app_job_pool'::regclass) then
    alter table public.app_job_pool add constraint app_job_pool_sponsorship_check
      check (sponsorship_status in ('explicit_h1b','visa_sponsorship','not_sponsored','unknown'));
  end if;
end $$;

create table if not exists public.app_job_feed_status (
  source text not null,
  source_board text not null,
  company text not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'pending' check (status in ('pending','syncing','ok','failed')),
  error_message text,
  jobs_seen int not null default 0,
  jobs_eligible int not null default 0,
  primary key (source, source_board)
);

create table if not exists public.app_member_resumes (
  id bigint generated always as identity primary key,
  client_code text not null references public.app_clients(code) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  file_name text not null,
  storage_path text not null unique,
  resume_text text not null,
  parsed_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(parsed_profile) = 'object'),
  latex_text text not null default '',
  is_primary boolean not null default false,
  replaced_by bigint references public.app_member_resumes(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_primary or archived_at is null)
);
create unique index if not exists app_member_resumes_one_primary
  on public.app_member_resumes(client_code) where is_primary;
create index if not exists app_member_resumes_client_idx on public.app_member_resumes(client_code,created_at desc);

create table if not exists public.app_member_job_activity (
  client_code text not null references public.app_clients(code) on delete cascade,
  job_id bigint not null references public.app_job_pool(id) on delete cascade,
  state text not null check (state in ('saved','skipped')),
  updated_at timestamptz not null default now(),
  primary key (client_code,job_id)
);

create table if not exists public.app_member_applications (
  id bigint generated always as identity primary key,
  client_code text not null references public.app_clients(code) on delete cascade,
  job_id bigint not null references public.app_job_pool(id),
  resume_id bigint not null references public.app_member_resumes(id),
  job_snapshot jsonb not null,
  resume_snapshot jsonb not null,
  score numeric check (score >= 0 and score <= 100),
  status text not null default 'opened' check (status in ('opened','applied','interview','offer','rejected','withdrawn')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (client_code,job_id)
);

-- Resolve exclusively from the authenticated JWT and the existing membership.
create or replace function public.fn_a_workspace_client_code()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select m.role_code from public.app_auth_map m
  join public.app_clients c on c.code=m.role_code
  where m.user_id=auth.uid() and m.role='client'
$$;

-- Same read scope as Mission Control: the client, assigned recruiters, and
-- managers/admins. No caller-supplied actor code is accepted.
create or replace function public.fn_a_workspace_can_read(p_client text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.app_auth_map m where m.user_id=auth.uid() and (
      (m.role='client' and m.role_code=p_client)
      or m.role in ('admin','manager')
      or (m.role='recruiter' and exists (
        select 1 from public.app_recruiters r where r.code=m.role_code and p_client=any(r.assigned)
      ))
    )
  )
$$;

alter table public.app_member_resumes enable row level security;
alter table public.app_member_job_activity enable row level security;
alter table public.app_member_applications enable row level security;
alter table public.app_job_feed_status enable row level security;

drop policy if exists member_resumes_read on public.app_member_resumes;
create policy member_resumes_read on public.app_member_resumes for select to authenticated
  using (public.fn_a_workspace_can_read(client_code));
drop policy if exists member_job_activity_read on public.app_member_job_activity;
create policy member_job_activity_read on public.app_member_job_activity for select to authenticated
  using (public.fn_a_workspace_can_read(client_code));
drop policy if exists member_applications_read on public.app_member_applications;
create policy member_applications_read on public.app_member_applications for select to authenticated
  using (public.fn_a_workspace_can_read(client_code));
-- No direct writes. Definer RPCs below validate ownership and serialize changes.
revoke all on public.app_member_resumes, public.app_member_job_activity,
  public.app_member_applications, public.app_job_feed_status from anon, authenticated;
grant select on public.app_member_resumes, public.app_member_job_activity,
  public.app_member_applications to authenticated;
grant all on public.app_member_resumes, public.app_member_job_activity,
  public.app_member_applications, public.app_job_feed_status to service_role;
grant usage, select on sequence public.app_member_resumes_id_seq,
  public.app_member_applications_id_seq to service_role;

-- Private immutable originals. Upload a unique object before registering it.
-- No UPDATE policy (upsert must be false). Registered/archived files cannot be
-- deleted by a browser. Service-side maintenance can remove abandoned uploads.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('client-resumes','client-resumes',false,5242880,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.fn_a_workspace_can_read_object(p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_member_resumes r
    where r.storage_path=p_name and public.fn_a_workspace_can_read(r.client_code))
    or (split_part(p_name,'/',1)=auth.uid()::text and public.fn_a_workspace_client_code() is not null)
$$;
drop policy if exists member_resume_object_upload on storage.objects;
create policy member_resume_object_upload on storage.objects for insert to authenticated
  with check (bucket_id='client-resumes' and split_part(name,'/',1)=auth.uid()::text
    and public.fn_a_workspace_client_code() is not null);
drop policy if exists member_resume_object_read on storage.objects;
create policy member_resume_object_read on storage.objects for select to authenticated
  using (bucket_id='client-resumes' and public.fn_a_workspace_can_read_object(name));
drop policy if exists member_resume_object_cleanup on storage.objects;

-- Keep the pre-existing matching/copilot profile in sync with the chosen resume.
-- EEO and preferences are not inferred or overwritten.
create or replace function public.fn_a_workspace_sync_profile(p_client text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.app_member_resumes%rowtype;
begin
  select * into r from public.app_member_resumes where client_code=p_client and is_primary;
  if not found then return; end if;
  insert into public.app_copilot_profiles(client_code,full_name,email,phone,location,education,employment,skills,resume_text,updated_at)
  values (p_client,coalesce(r.parsed_profile->>'name',''),coalesce(r.parsed_profile->>'email',''),
    coalesce(r.parsed_profile->>'phone',''),coalesce(r.parsed_profile->>'location',''),
    coalesce(r.parsed_profile->>'education',''),coalesce(r.parsed_profile->>'experience',''),
    coalesce(r.parsed_profile->>'skills',''),r.resume_text,now())
  on conflict(client_code) do update set full_name=excluded.full_name,email=excluded.email,
    phone=excluded.phone,location=excluded.location,education=excluded.education,
    employment=excluded.employment,skills=excluded.skills,resume_text=excluded.resume_text,updated_at=now();
end $$;

create or replace function public.fn_a_save_my_resume(
  p_file_name text,p_storage_path text,p_resume_text text,p_parsed_profile jsonb,p_latex_text text,
  p_replace_id bigint default null
)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code(); v_primary boolean; v_old public.app_member_resumes%rowtype; v_new public.app_member_resumes%rowtype;
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  if coalesce(p_file_name,'') !~* '\.(pdf|docx)$' or length(p_file_name)>240
    or length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or coalesce(jsonb_typeof(p_parsed_profile),'')<>'object' or octet_length(p_parsed_profile::text)>500000
    or length(coalesce(p_latex_text,''))>500000 then
    return json_build_object('ok',false,'err','A PDF/DOCX, extracted resume text and valid profile are required');
  end if;
  if split_part(p_storage_path,'/',1) is distinct from auth.uid()::text
    or not exists (select 1 from storage.objects where bucket_id='client-resumes' and name=p_storage_path) then
    return json_build_object('ok',false,'err','Upload your resume to private storage before saving');
  end if;
  -- A row lock serializes primary selection, replace, and concurrent uploads.
  perform 1 from public.app_clients where code=v_code for update;
  if exists (select 1 from public.app_member_resumes where storage_path=p_storage_path) then
    return json_build_object('ok',false,'err','This upload is already registered');
  end if;
  if p_replace_id is not null then
    select * into v_old from public.app_member_resumes where id=p_replace_id and client_code=v_code and archived_at is null for update;
    if not found then return json_build_object('ok',false,'err','Resume to replace was not found'); end if;
    v_primary:=v_old.is_primary;
    update public.app_member_resumes set is_primary=false,archived_at=now(),updated_at=now() where id=v_old.id;
  else
    v_primary:=not exists(select 1 from public.app_member_resumes where client_code=v_code and is_primary);
  end if;
  insert into public.app_member_resumes(client_code,owner_user_id,file_name,storage_path,resume_text,parsed_profile,latex_text,is_primary)
    values(v_code,auth.uid(),p_file_name,p_storage_path,p_resume_text,p_parsed_profile,coalesce(p_latex_text,''),v_primary)
    returning * into v_new;
  if p_replace_id is not null then update public.app_member_resumes set replaced_by=v_new.id where id=p_replace_id; end if;
  perform public.fn_a_workspace_sync_profile(v_code);
  return json_build_object('ok',true,'resume',row_to_json(v_new));
end $$;

create or replace function public.fn_a_set_primary_resume(p_resume_id bigint)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code();
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  perform 1 from public.app_clients where code=v_code for update;
  if not exists(select 1 from public.app_member_resumes where id=p_resume_id and client_code=v_code and archived_at is null) then
    return json_build_object('ok',false,'err','Resume not found');
  end if;
  update public.app_member_resumes set is_primary=false,updated_at=now() where client_code=v_code and is_primary;
  update public.app_member_resumes set is_primary=true,updated_at=now() where id=p_resume_id;
  perform public.fn_a_workspace_sync_profile(v_code);
  return json_build_object('ok',true);
end $$;

create or replace function public.fn_a_update_my_resume(p_resume_id bigint,p_resume_text text,p_parsed_profile jsonb,p_latex_text text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code();
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  if length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or coalesce(jsonb_typeof(p_parsed_profile),'')<>'object' or octet_length(p_parsed_profile::text)>500000
    or length(coalesce(p_latex_text,''))>500000 then
    return json_build_object('ok',false,'err','Invalid resume text or profile');
  end if;
  perform 1 from public.app_clients where code=v_code for update;
  update public.app_member_resumes set resume_text=p_resume_text,parsed_profile=p_parsed_profile,
    latex_text=coalesce(p_latex_text,''),updated_at=now()
    where id=p_resume_id and client_code=v_code and archived_at is null;
  if not found then return json_build_object('ok',false,'err','Resume not found'); end if;
  perform public.fn_a_workspace_sync_profile(v_code);
  return json_build_object('ok',true);
end $$;

create or replace function public.fn_a_set_job_activity(p_job_id bigint,p_state text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code();
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  if p_state is null or p_state not in ('saved','skipped','none') then return json_build_object('ok',false,'err','Invalid activity'); end if;
  if not exists(select 1 from public.app_job_pool where id=p_job_id) then return json_build_object('ok',false,'err','Job not found'); end if;
  if p_state='none' then delete from public.app_member_job_activity where client_code=v_code and job_id=p_job_id;
  else
    insert into public.app_member_job_activity(client_code,job_id,state) values(v_code,p_job_id,p_state)
      on conflict(client_code,job_id) do update set state=excluded.state,updated_at=now();
  end if;
  return json_build_object('ok',true);
end $$;

-- Snapshot content is never overwritten when the job, resume, or profile changes.
-- The browser may change progress, but only the member can report application
-- completion: opening the company's site is NOT proof of submission.
create or replace function public.fn_a_member_application_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.client_code is distinct from old.client_code or new.job_id is distinct from old.job_id
    or new.resume_id is distinct from old.resume_id or new.job_snapshot is distinct from old.job_snapshot
    or new.resume_snapshot is distinct from old.resume_snapshot or new.score is distinct from old.score
    or new.created_at is distinct from old.created_at then
    raise exception 'Application snapshots are immutable';
  end if;
  return new;
end $$;
drop trigger if exists member_application_immutable on public.app_member_applications;
create trigger member_application_immutable before update on public.app_member_applications
  for each row execute function public.fn_a_member_application_immutable();

create or replace function public.fn_a_log_application(
  p_job_id bigint,p_resume_id bigint,p_resume_text text,p_latex_text text,p_score numeric,
  p_status text default 'opened',p_notes text default '',p_parsed_profile jsonb default null
)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code(); v_resume public.app_member_resumes%rowtype; v_job public.app_job_pool%rowtype; v_id bigint; v_existing_url text;
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  if p_status is null or p_status not in ('opened','applied') or p_score<0 or p_score>100
    or length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or length(coalesce(p_latex_text,''))>500000 or length(coalesce(p_notes,''))>10000
    or (p_parsed_profile is not null and (jsonb_typeof(p_parsed_profile)<>'object' or octet_length(p_parsed_profile::text)>500000)) then
    return json_build_object('ok',false,'err','Invalid application snapshot');
  end if;
  perform 1 from public.app_clients where code=v_code for update;
  select id,job_snapshot->>'url' into v_id,v_existing_url from public.app_member_applications where client_code=v_code and job_id=p_job_id;
  if found then return json_build_object('ok',true,'id',v_id,'already',true,'url',v_existing_url); end if;
  select * into v_resume from public.app_member_resumes where id=p_resume_id and client_code=v_code and archived_at is null;
  if not found then return json_build_object('ok',false,'err','Resume not found'); end if;
  select * into v_job from public.app_job_pool where id=p_job_id and status='active' and country_code='US'
    and sponsorship_status='explicit_h1b' and coalesce(sponsorship_evidence,'')<>''
    and sponsorship_evidence_url ~ '^https://' and url ~ '^https://'
    and date_basis<>'unknown' and posted_at between now()-interval '30 days' and now()
    and last_verified_at between now()-interval '24 hours' and now();
  if not found then return json_build_object('ok',false,'err','This job needs a fresh H-1B/source verification before applying'); end if;
  insert into public.app_member_applications(client_code,job_id,resume_id,job_snapshot,resume_snapshot,score,status,notes,applied_at)
  values (v_code,p_job_id,p_resume_id,
    to_jsonb(v_job)-'raw_json',
    jsonb_build_object('resume_id',v_resume.id,'file_name',v_resume.file_name,'storage_path',v_resume.storage_path,
      'resume_text',p_resume_text,'latex_text',coalesce(p_latex_text,''),'parsed_profile',coalesce(p_parsed_profile,v_resume.parsed_profile)),
    p_score,p_status,coalesce(p_notes,''),case when p_status='applied' then now() end)
    returning id into v_id;
  return json_build_object('ok',true,'id',v_id,'already',false,'url',v_job.url);
end $$;

create or replace function public.fn_a_update_application_status(p_application_id bigint,p_status text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code();
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  if p_status is null or p_status not in ('opened','applied','interview','offer','rejected','withdrawn') then
    return json_build_object('ok',false,'err','Invalid application status');
  end if;
  update public.app_member_applications set status=p_status,updated_at=now(),
    applied_at=case when p_status in ('applied','interview','offer','rejected') then coalesce(applied_at,now()) else applied_at end
    where id=p_application_id and client_code=v_code;
  if not found then return json_build_object('ok',false,'err','Application not found'); end if;
  return json_build_object('ok',true);
end $$;

create or replace function public.fn_a_discover_jobs(p_limit int default 200)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code();
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  return json_build_object('ok',true,'jobs',(
    select coalesce(json_agg(x order by x.posted_at desc,x.id desc),'[]'::json) from (
      select j.id,j.company,j.title,j.source,j.url,j.posted_at,j.ats_type,j.location,j.description,
        j.employment_type,j.salary_text,j.work_mode,j.role_level,j.years_required,
        j.source_board,j.source_job_id,j.date_basis,j.source_updated_at,j.first_seen_at,j.last_seen_at,
        j.last_verified_at,j.status,j.country_code,j.sponsorship_status,j.sponsorship_evidence,j.sponsorship_evidence_url
      from public.app_job_pool j where j.status='active' and j.country_code='US'
        and j.sponsorship_status='explicit_h1b' and coalesce(j.sponsorship_evidence,'')<>''
        and j.sponsorship_evidence_url ~ '^https://' and j.url ~ '^https://'
        and j.date_basis<>'unknown' and j.posted_at between now()-interval '30 days' and now()
        and j.last_verified_at between now()-interval '24 hours' and now()
      order by j.posted_at desc,j.id desc limit greatest(1,least(coalesce(p_limit,200),1000))
    ) x
  ),'feed_status',(
    select coalesce(json_agg(json_build_object('source',f.source,'source_board',f.source_board,'company',f.company,
      'last_attempt_at',f.last_attempt_at,'last_success_at',f.last_success_at,'status',f.status,
      'jobs_seen',f.jobs_seen,'jobs_eligible',f.jobs_eligible) order by f.company),'[]'::json)
    from public.app_job_feed_status f
  ));
end $$;

create or replace function public.fn_a_get_my_workspace()
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text:=public.fn_a_workspace_client_code();
begin
  if v_code is null then return json_build_object('ok',false,'err','Client membership required'); end if;
  return json_build_object('ok',true,'client_code',v_code,
    'resumes',(select coalesce(json_agg(r order by r.is_primary desc,r.created_at desc),'[]'::json)
      from public.app_member_resumes r where r.client_code=v_code and r.archived_at is null),
    'activity',(select coalesce(json_agg(x order by x.updated_at desc),'[]'::json) from (
      select a.*,to_jsonb(j)-'raw_json' as job from public.app_member_job_activity a
      join public.app_job_pool j on j.id=a.job_id where a.client_code=v_code
    ) x),
    'applications',(select coalesce(json_agg(x order by x.created_at desc),'[]'::json) from (
      select a.*,a.job_snapshot->>'company' as company,a.job_snapshot->>'title' as title,a.job_snapshot->>'url' as url,
        a.resume_snapshot->>'file_name' as file_name,a.resume_snapshot->>'resume_text' as resume_text,
        a.resume_snapshot->>'latex_text' as latex_text
      from public.app_member_applications a where a.client_code=v_code
    ) x),
    'feed_status',(select coalesce(json_agg(json_build_object('source',f.source,'source_board',f.source_board,
      'company',f.company,'last_success_at',f.last_success_at,'status',f.status,
      'jobs_seen',f.jobs_seen,'jobs_eligible',f.jobs_eligible) order by f.company),'[]'::json) from public.app_job_feed_status f)
  );
end $$;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions by default. Explicitly
-- revoke it before granting the minimal browser API and safe RLS helpers.
revoke all on function
  public.fn_a_workspace_client_code(),public.fn_a_workspace_can_read(text),
  public.fn_a_workspace_can_read_object(text),
  public.fn_a_workspace_sync_profile(text),public.fn_a_member_application_immutable(),
  public.fn_a_save_my_resume(text,text,text,jsonb,text,bigint),public.fn_a_set_primary_resume(bigint),
  public.fn_a_update_my_resume(bigint,text,jsonb,text),public.fn_a_set_job_activity(bigint,text),
  public.fn_a_log_application(bigint,bigint,text,text,numeric,text,text,jsonb),
  public.fn_a_update_application_status(bigint,text),public.fn_a_discover_jobs(int),public.fn_a_get_my_workspace()
  from public,anon,authenticated;
grant execute on function
  public.fn_a_workspace_client_code(),public.fn_a_workspace_can_read(text),
  public.fn_a_workspace_can_read_object(text),
  public.fn_a_save_my_resume(text,text,text,jsonb,text,bigint),public.fn_a_set_primary_resume(bigint),
  public.fn_a_update_my_resume(bigint,text,jsonb,text),public.fn_a_set_job_activity(bigint,text),
  public.fn_a_log_application(bigint,bigint,text,text,numeric,text,text,jsonb),
  public.fn_a_update_application_status(bigint,text),public.fn_a_discover_jobs(int),public.fn_a_get_my_workspace()
  to authenticated;

commit;
