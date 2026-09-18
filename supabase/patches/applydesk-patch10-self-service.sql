-- ApplyDesk patch 10: independent self-service product under the ApplyDesk brand.
-- Apply after patches 5, 7, 8, and 9. No users or client data are migrated.
-- Existing recruiter-managed clients and portal data remain separate.
begin;

create table if not exists public.app_selfserve_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  status text not null default 'active' check (status in ('active','suspended')),
  admin_notes text not null default '' check (length(admin_notes)<=10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.app_selfserve_resumes (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_selfserve_members(user_id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  resume_text text not null,
  parsed_profile jsonb not null default '{}'::jsonb check (jsonb_typeof(parsed_profile)='object'),
  latex_text text not null default '',
  is_primary boolean not null default false,
  replaced_by bigint references public.app_selfserve_resumes(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not is_primary or archived_at is null),
  unique(id,user_id)
);
create unique index if not exists app_selfserve_resumes_one_primary
  on public.app_selfserve_resumes(user_id) where is_primary;
create index if not exists app_selfserve_resumes_user_idx
  on public.app_selfserve_resumes(user_id,created_at desc);
create table if not exists public.app_selfserve_job_activity (
  user_id uuid not null references public.app_selfserve_members(user_id) on delete cascade,
  job_id bigint not null references public.app_job_pool(id) on delete cascade,
  state text not null check (state in ('saved','skipped')),
  updated_at timestamptz not null default now(),
  primary key (user_id,job_id)
);
create table if not exists public.app_selfserve_applications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.app_selfserve_members(user_id) on delete cascade,
  job_id bigint not null references public.app_job_pool(id),
  resume_id bigint not null,
  job_snapshot jsonb not null,
  resume_snapshot jsonb not null,
  score numeric check (score>=0 and score<=100),
  status text not null default 'opened' check (status in ('opened','applied','interview','offer','rejected','withdrawn')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  foreign key(resume_id,user_id) references public.app_selfserve_resumes(id,user_id),
  unique(user_id,job_id)
);
create index if not exists app_selfserve_applications_user_idx
  on public.app_selfserve_applications(user_id,created_at desc);
create table if not exists public.app_selfserve_admin_audit (
  id bigint generated always as identity primary key,
  member_user_id uuid not null references public.app_selfserve_members(user_id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('view_member','update_member')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists app_selfserve_admin_audit_member_idx
  on public.app_selfserve_admin_audit(member_user_id,created_at desc);

-- All authorization is resolved against trusted database rows. Signup metadata
-- never grants a role, and an existing client/recruiter/manager is not a member.
create or replace function public.fn_ss_is_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.app_auth_map where user_id=auth.uid() and role='admin')
$$;
create or replace function public.fn_ss_active_user_id()
returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select s.user_id from public.app_selfserve_members s
  join auth.users u on u.id=s.user_id
  where s.user_id=auth.uid() and s.status='active' and u.email_confirmed_at is not null
    and not exists(select 1 from public.app_auth_map m where m.user_id=s.user_id)
$$;
create or replace function public.fn_ss_can_read(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.fn_ss_is_admin() or p_user_id=public.fn_ss_active_user_id()
$$;
create or replace function public.fn_ss_identity()
returns json language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_member public.app_selfserve_members%rowtype; v_email text;
begin
  if v_user is null then return json_build_object('ok',false,'err','Sign in to continue'); end if;
  if public.fn_ss_is_admin() then return json_build_object('ok',true,'kind','admin'); end if;
  if exists(select 1 from public.app_auth_map where user_id=v_user) then
    return json_build_object('ok',true,'kind','legacy');
  end if;
  select * into v_member from public.app_selfserve_members where user_id=v_user;
  if not found then return json_build_object('ok',true,'kind','unregistered'); end if;
  select email into v_email from auth.users where id=v_user;
  return json_build_object('ok',true,'kind','member','profile',json_build_object(
    'user_id',v_user,'full_name',v_member.full_name,'email',v_email,'status',v_member.status));
end $$;
create or replace function public.fn_ss_enroll(p_full_name text)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then return json_build_object('ok',false,'err','Sign in before creating your self-service profile'); end if;
  -- Lock the authenticated user while enrolling, never a caller-supplied uid.
  perform 1 from auth.users where id=v_user and email_confirmed_at is not null
    and nullif(trim(email),'') is not null for update;
  if not found then return json_build_object('ok',false,'err','Verify your email before continuing'); end if;
  if exists(select 1 from public.app_auth_map where user_id=v_user) then
    return json_build_object('ok',false,'err','This account belongs to the managed-service portal. Use a separate email for self-service.');
  end if;
  if exists(select 1 from public.app_selfserve_members where user_id=v_user) then return public.fn_ss_identity(); end if;
  if length(trim(coalesce(p_full_name,''))) not between 2 and 120 then
    return json_build_object('ok',false,'err','Enter your full name (2 to 120 characters)');
  end if;
  insert into public.app_selfserve_members(user_id,full_name) values(v_user,trim(p_full_name))
    on conflict(user_id) do nothing;
  return public.fn_ss_identity();
end $$;

alter table public.app_selfserve_members enable row level security;
alter table public.app_selfserve_resumes enable row level security;
alter table public.app_selfserve_job_activity enable row level security;
alter table public.app_selfserve_applications enable row level security;
alter table public.app_selfserve_admin_audit enable row level security;
-- The member identity RPC exposes a deliberately small profile; admin_notes
-- never become visible to members through a direct SELECT.
drop policy if exists selfserve_members_read on public.app_selfserve_members;
create policy selfserve_members_read on public.app_selfserve_members for select to authenticated
  using(public.fn_ss_is_admin());
drop policy if exists selfserve_resumes_read on public.app_selfserve_resumes;
create policy selfserve_resumes_read on public.app_selfserve_resumes for select to authenticated
  using(public.fn_ss_can_read(user_id));
drop policy if exists selfserve_activity_read on public.app_selfserve_job_activity;
create policy selfserve_activity_read on public.app_selfserve_job_activity for select to authenticated
  using(public.fn_ss_can_read(user_id));
drop policy if exists selfserve_applications_read on public.app_selfserve_applications;
create policy selfserve_applications_read on public.app_selfserve_applications for select to authenticated
  using(public.fn_ss_can_read(user_id));
drop policy if exists selfserve_audit_read on public.app_selfserve_admin_audit;
create policy selfserve_audit_read on public.app_selfserve_admin_audit for select to authenticated
  using(public.fn_ss_is_admin());
revoke all on public.app_selfserve_members,public.app_selfserve_resumes,
  public.app_selfserve_job_activity,public.app_selfserve_applications,public.app_selfserve_admin_audit
  from public,anon,authenticated;
grant select on public.app_selfserve_members,public.app_selfserve_resumes,
  public.app_selfserve_job_activity,public.app_selfserve_applications,public.app_selfserve_admin_audit to authenticated;
grant all on public.app_selfserve_members,public.app_selfserve_resumes,
  public.app_selfserve_job_activity,public.app_selfserve_applications,public.app_selfserve_admin_audit to service_role;
grant usage,select on sequence public.app_selfserve_resumes_id_seq,
  public.app_selfserve_applications_id_seq,public.app_selfserve_admin_audit_id_seq to service_role;

-- Immutable originals live in a separate private bucket. Neither members nor
-- admins may overwrite/delete originals through browser storage calls.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('selfserve-resumes','selfserve-resumes',false,5242880,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
create or replace function public.fn_ss_can_read_object(p_name text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.app_selfserve_resumes r
    where r.storage_path=p_name and public.fn_ss_can_read(r.user_id))
    or split_part(p_name,'/',1)=public.fn_ss_active_user_id()::text
$$;
drop policy if exists selfserve_resume_upload on storage.objects;
create policy selfserve_resume_upload on storage.objects for insert to authenticated
  with check(bucket_id='selfserve-resumes' and split_part(name,'/',1)=public.fn_ss_active_user_id()::text);
drop policy if exists selfserve_resume_read on storage.objects;
create policy selfserve_resume_read on storage.objects for select to authenticated
  using(bucket_id='selfserve-resumes' and public.fn_ss_can_read_object(name));
-- Restrictive guards also prevent a pre-existing broad storage policy from
-- accidentally granting access to this private product's bucket.
drop policy if exists selfserve_resume_select_guard on storage.objects;
create policy selfserve_resume_select_guard on storage.objects as restrictive for select to authenticated
  using(bucket_id<>'selfserve-resumes' or public.fn_ss_can_read_object(name));
drop policy if exists selfserve_resume_insert_guard on storage.objects;
create policy selfserve_resume_insert_guard on storage.objects as restrictive for insert to authenticated
  with check(bucket_id<>'selfserve-resumes' or split_part(name,'/',1)=public.fn_ss_active_user_id()::text);
drop policy if exists selfserve_resume_update_guard on storage.objects;
create policy selfserve_resume_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'selfserve-resumes') with check(bucket_id<>'selfserve-resumes');
drop policy if exists selfserve_resume_delete_guard on storage.objects;
create policy selfserve_resume_delete_guard on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'selfserve-resumes');
drop policy if exists selfserve_resume_anon_guard on storage.objects;
create policy selfserve_resume_anon_guard on storage.objects as restrictive for all to anon
  using(bucket_id<>'selfserve-resumes') with check(bucket_id<>'selfserve-resumes');

-- Serialize member writes with admin suspension and primary selection. After
-- waiting for a lock, check the row's current status before any mutation.
create or replace function public.fn_ss_lock_member()
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); v_status text;
begin
  if v_user is null then return null; end if;
  select status into v_status from public.app_selfserve_members where user_id=v_user for update;
  if v_status is distinct from 'active'
    or exists(select 1 from public.app_auth_map where user_id=v_user)
    or not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null)
    then return null; end if;
  return v_user;
end $$;

create or replace function public.fn_ss_save_my_resume(
  p_file_name text,p_storage_path text,p_resume_text text,p_parsed_profile jsonb,p_latex_text text,
  p_replace_id bigint default null
)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member(); v_primary boolean; v_old public.app_selfserve_resumes%rowtype; v_new public.app_selfserve_resumes%rowtype;
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if coalesce(p_file_name,'') !~* '\.(pdf|docx)$' or length(p_file_name)>240
    or length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or coalesce(jsonb_typeof(p_parsed_profile),'')<>'object' or octet_length(p_parsed_profile::text)>500000
    or length(coalesce(p_latex_text,''))>500000 then
    return json_build_object('ok',false,'err','A PDF/DOCX, extracted resume text and valid profile are required');
  end if;
  if split_part(p_storage_path,'/',1) is distinct from auth.uid()::text
    or not exists (select 1 from storage.objects where bucket_id='selfserve-resumes' and name=p_storage_path) then
    return json_build_object('ok',false,'err','Upload your resume to private storage before saving');
  end if;
  -- A row lock serializes primary selection, replace, and concurrent uploads.
  if exists (select 1 from public.app_selfserve_resumes where storage_path=p_storage_path) then
    return json_build_object('ok',false,'err','This upload is already registered');
  end if;
  if p_replace_id is not null then
    select * into v_old from public.app_selfserve_resumes where id=p_replace_id and user_id=v_user and archived_at is null for update;
    if not found then return json_build_object('ok',false,'err','Resume to replace was not found'); end if;
    v_primary:=v_old.is_primary;
    update public.app_selfserve_resumes set is_primary=false,archived_at=now(),updated_at=now() where id=v_old.id;
  else
    v_primary:=not exists(select 1 from public.app_selfserve_resumes where user_id=v_user and is_primary);
  end if;
  insert into public.app_selfserve_resumes(user_id,file_name,storage_path,resume_text,parsed_profile,latex_text,is_primary)
    values(v_user,p_file_name,p_storage_path,p_resume_text,p_parsed_profile,coalesce(p_latex_text,''),v_primary)
    returning * into v_new;
  if p_replace_id is not null then update public.app_selfserve_resumes set replaced_by=v_new.id where id=p_replace_id; end if;
  return json_build_object('ok',true,'resume',row_to_json(v_new));
end $$;

create or replace function public.fn_ss_set_primary_resume(p_resume_id bigint)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if not exists(select 1 from public.app_selfserve_resumes where id=p_resume_id and user_id=v_user and archived_at is null) then
    return json_build_object('ok',false,'err','Resume not found');
  end if;
  update public.app_selfserve_resumes set is_primary=false,updated_at=now() where user_id=v_user and is_primary;
  update public.app_selfserve_resumes set is_primary=true,updated_at=now() where id=p_resume_id;
  return json_build_object('ok',true);
end $$;

create or replace function public.fn_ss_update_my_resume(p_resume_id bigint,p_resume_text text,p_parsed_profile jsonb,p_latex_text text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or coalesce(jsonb_typeof(p_parsed_profile),'')<>'object' or octet_length(p_parsed_profile::text)>500000
    or length(coalesce(p_latex_text,''))>500000 then
    return json_build_object('ok',false,'err','Invalid resume text or profile');
  end if;
  update public.app_selfserve_resumes set resume_text=p_resume_text,parsed_profile=p_parsed_profile,
    latex_text=coalesce(p_latex_text,''),updated_at=now()
    where id=p_resume_id and user_id=v_user and archived_at is null;
  if not found then return json_build_object('ok',false,'err','Resume not found'); end if;
  return json_build_object('ok',true);
end $$;

create or replace function public.fn_ss_set_job_activity(p_job_id bigint,p_state text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if p_state is null or p_state not in ('saved','skipped','none') then return json_build_object('ok',false,'err','Invalid activity'); end if;
  if not exists(select 1 from public.app_job_pool where id=p_job_id) then return json_build_object('ok',false,'err','Job not found'); end if;
  if p_state='none' then delete from public.app_selfserve_job_activity where user_id=v_user and job_id=p_job_id;
  else
    insert into public.app_selfserve_job_activity(user_id,job_id,state) values(v_user,p_job_id,p_state)
      on conflict(user_id,job_id) do update set state=excluded.state,updated_at=now();
  end if;
  return json_build_object('ok',true);
end $$;

-- Snapshot content is never overwritten when the job, resume, or profile changes.
-- The browser may change progress, but only the member can report application
-- completion: opening the company's site is NOT proof of submission.
create or replace function public.fn_ss_application_immutable()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.user_id is distinct from old.user_id or new.job_id is distinct from old.job_id
    or new.resume_id is distinct from old.resume_id or new.job_snapshot is distinct from old.job_snapshot
    or new.resume_snapshot is distinct from old.resume_snapshot or new.score is distinct from old.score
    or new.created_at is distinct from old.created_at then
    raise exception 'Application snapshots are immutable';
  end if;
  return new;
end $$;
drop trigger if exists selfserve_application_immutable on public.app_selfserve_applications;
create trigger selfserve_application_immutable before update on public.app_selfserve_applications
  for each row execute function public.fn_ss_application_immutable();

create or replace function public.fn_ss_log_application(
  p_job_id bigint,p_resume_id bigint,p_resume_text text,p_latex_text text,p_score numeric,
  p_status text default 'opened',p_notes text default '',p_parsed_profile jsonb default null
)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member(); v_resume public.app_selfserve_resumes%rowtype; v_job public.app_job_pool%rowtype; v_id bigint; v_existing_url text;
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if p_status is null or p_status not in ('opened','applied') or p_score<0 or p_score>100
    or length(trim(coalesce(p_resume_text,'')))<20 or length(p_resume_text)>200000
    or length(coalesce(p_latex_text,''))>500000 or length(coalesce(p_notes,''))>10000
    or (p_parsed_profile is not null and (jsonb_typeof(p_parsed_profile)<>'object' or octet_length(p_parsed_profile::text)>500000)) then
    return json_build_object('ok',false,'err','Invalid application snapshot');
  end if;
  select id,job_snapshot->>'url' into v_id,v_existing_url from public.app_selfserve_applications where user_id=v_user and job_id=p_job_id;
  if found then return json_build_object('ok',true,'id',v_id,'already',true,'url',v_existing_url); end if;
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
    jsonb_build_object('resume_id',v_resume.id,'file_name',v_resume.file_name,'storage_path',v_resume.storage_path,
      'resume_text',p_resume_text,'latex_text',coalesce(p_latex_text,''),'parsed_profile',coalesce(p_parsed_profile,v_resume.parsed_profile)),
    p_score,p_status,coalesce(p_notes,''),case when p_status='applied' then now() end)
    returning id into v_id;
  return json_build_object('ok',true,'id',v_id,'already',false,'url',v_job.url);
end $$;

create or replace function public.fn_ss_update_application_status(p_application_id bigint,p_status text)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_lock_member();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  if p_status is null or p_status not in ('opened','applied','interview','offer','rejected','withdrawn') then
    return json_build_object('ok',false,'err','Invalid application status');
  end if;
  update public.app_selfserve_applications set status=p_status,updated_at=now(),
    applied_at=case when p_status in ('applied','interview','offer','rejected') then coalesce(applied_at,now()) else applied_at end
    where id=p_application_id and user_id=v_user;
  if not found then return json_build_object('ok',false,'err','Application not found'); end if;
  return json_build_object('ok',true);
end $$;

create or replace function public.fn_ss_discover_jobs(p_limit int default 200)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_active_user_id();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
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

create or replace function public.fn_ss_get_my_workspace()
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid:=public.fn_ss_active_user_id();
begin
  if v_user is null then return json_build_object('ok',false,'err','An active self-service account is required'); end if;
  return json_build_object('ok',true,'user_id',v_user,
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

-- Admin tools belong to the existing administrator, never recruiters/managers.
-- The server reads current email from Auth; there is no second stale copy.
create or replace function public.fn_ss_admin_list_members(
  p_search text default '',p_offset int default 0,p_limit int default 50
)
returns json language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_query text:=lower(trim(coalesce(p_search,'')));
begin
  if not public.fn_ss_is_admin() then return json_build_object('ok',false,'err','Administrator access required'); end if;
  if length(v_query)>200 then return json_build_object('ok',false,'err','Search must be 200 characters or less'); end if;
  return json_build_object('ok',true,'total',(
    select count(*) from public.app_selfserve_members m join auth.users u on u.id=m.user_id
    where v_query='' or strpos(lower(m.full_name),v_query)>0 or strpos(lower(coalesce(u.email,'')),v_query)>0
  ),'members',(
    select coalesce(json_agg(x order by x.created_at desc,x.user_id),'[]'::json) from (
      select m.user_id,m.full_name,u.email,m.status,m.created_at,m.updated_at,
        (select count(*) from public.app_selfserve_resumes r where r.user_id=m.user_id and r.archived_at is null) as resume_count,
        (select count(*) from public.app_selfserve_applications a where a.user_id=m.user_id) as application_count
      from public.app_selfserve_members m join auth.users u on u.id=m.user_id
      where v_query='' or strpos(lower(m.full_name),v_query)>0 or strpos(lower(coalesce(u.email,'')),v_query)>0
      order by m.created_at desc,m.user_id
      limit greatest(1,least(coalesce(p_limit,50),100)) offset greatest(0,coalesce(p_offset,0))
    ) x
  ));
end $$;

create or replace function public.fn_ss_admin_member_detail(p_user_id uuid)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_member json;
begin
  if not public.fn_ss_is_admin() then return json_build_object('ok',false,'err','Administrator access required'); end if;
  select row_to_json(x) into v_member from (
    select m.*,u.email from public.app_selfserve_members m join auth.users u on u.id=m.user_id
      where m.user_id=p_user_id
  ) x;
  if v_member is null then return json_build_object('ok',false,'err','Self-service member not found'); end if;
  insert into public.app_selfserve_admin_audit(member_user_id,actor_user_id,action)
    values(p_user_id,auth.uid(),'view_member');
  return json_build_object('ok',true,'member',v_member,
    'resumes',(select coalesce(json_agg(r order by r.created_at desc,r.id desc),'[]'::json)
      from public.app_selfserve_resumes r where r.user_id=p_user_id),
    'activity',(select coalesce(json_agg(x order by x.updated_at desc),'[]'::json) from (
      select a.*,to_jsonb(j)-'raw_json' as job from public.app_selfserve_job_activity a
        join public.app_job_pool j on j.id=a.job_id where a.user_id=p_user_id
    ) x),
    'applications',(select coalesce(json_agg(x order by x.created_at desc,x.id desc),'[]'::json) from (
      select a.*,a.job_snapshot->>'company' as company,a.job_snapshot->>'title' as title,
        a.job_snapshot->>'url' as url,a.resume_snapshot->>'file_name' as file_name,
        a.resume_snapshot->>'resume_text' as resume_text,a.resume_snapshot->>'latex_text' as latex_text
      from public.app_selfserve_applications a where a.user_id=p_user_id
    ) x),
    'audit',(select coalesce(json_agg(x order by x.created_at desc,x.id desc),'[]'::json) from (
      select a.*,u.email as actor_email from public.app_selfserve_admin_audit a
        left join auth.users u on u.id=a.actor_user_id where a.member_user_id=p_user_id
        order by a.created_at desc,a.id desc limit 100
    ) x)
  );
end $$;

create or replace function public.fn_ss_admin_update_member(p_user_id uuid,p_status text,p_admin_notes text)
returns json language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before public.app_selfserve_members%rowtype;
begin
  if not public.fn_ss_is_admin() then return json_build_object('ok',false,'err','Administrator access required'); end if;
  if p_status is null or p_status not in ('active','suspended') or length(coalesce(p_admin_notes,''))>10000 then
    return json_build_object('ok',false,'err','Choose active or suspended and keep notes within 10000 characters');
  end if;
  select * into v_before from public.app_selfserve_members where user_id=p_user_id for update;
  if not found then return json_build_object('ok',false,'err','Self-service member not found'); end if;
  if v_before.status is distinct from p_status or v_before.admin_notes is distinct from coalesce(p_admin_notes,'') then
    update public.app_selfserve_members set status=p_status,admin_notes=coalesce(p_admin_notes,''),updated_at=now()
      where user_id=p_user_id;
    insert into public.app_selfserve_admin_audit(member_user_id,actor_user_id,action,details)
      values(p_user_id,auth.uid(),'update_member',jsonb_build_object('before',
        jsonb_build_object('status',v_before.status,'admin_notes',v_before.admin_notes),'after',
        jsonb_build_object('status',p_status,'admin_notes',coalesce(p_admin_notes,''))));
  end if;
  return json_build_object('ok',true);
end $$;

-- Minimal browser RPC access; PostgreSQL defaults new functions to PUBLIC.
revoke all on function
  public.fn_ss_is_admin(),public.fn_ss_active_user_id(),public.fn_ss_can_read(uuid),public.fn_ss_can_read_object(text),
  public.fn_ss_identity(),public.fn_ss_enroll(text),public.fn_ss_lock_member(),public.fn_ss_application_immutable(),
  public.fn_ss_save_my_resume(text,text,text,jsonb,text,bigint),public.fn_ss_set_primary_resume(bigint),
  public.fn_ss_update_my_resume(bigint,text,jsonb,text),public.fn_ss_set_job_activity(bigint,text),
  public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb),
  public.fn_ss_update_application_status(bigint,text),public.fn_ss_discover_jobs(int),public.fn_ss_get_my_workspace(),
  public.fn_ss_admin_list_members(text,int,int),public.fn_ss_admin_member_detail(uuid),public.fn_ss_admin_update_member(uuid,text,text)
  from public,anon,authenticated;
grant execute on function
  public.fn_ss_is_admin(),public.fn_ss_active_user_id(),public.fn_ss_can_read(uuid),public.fn_ss_can_read_object(text),
  public.fn_ss_identity(),public.fn_ss_enroll(text),
  public.fn_ss_save_my_resume(text,text,text,jsonb,text,bigint),public.fn_ss_set_primary_resume(bigint),
  public.fn_ss_update_my_resume(bigint,text,jsonb,text),public.fn_ss_set_job_activity(bigint,text),
  public.fn_ss_log_application(bigint,bigint,text,text,numeric,text,text,jsonb),
  public.fn_ss_update_application_status(bigint,text),public.fn_ss_discover_jobs(int),public.fn_ss_get_my_workspace(),
  public.fn_ss_admin_list_members(text,int,int),public.fn_ss_admin_member_detail(uuid),public.fn_ss_admin_update_member(uuid,text,text)
  to authenticated;
revoke all on sequence public.app_selfserve_resumes_id_seq,
  public.app_selfserve_applications_id_seq,public.app_selfserve_admin_audit_id_seq from public,anon,authenticated;

commit;
