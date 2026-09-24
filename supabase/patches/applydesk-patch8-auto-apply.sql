-- ═══════════════════════════════════════════════════════════════
-- APPLYDESK PATCH 8: AUTO APPLY COPILOT
--
-- NEW TABLES ONLY. Does not ALTER app_clients, app_records, or
-- any other existing table. Review this file, then paste into the
-- SQL editor yourself (staging first). Do not auto-apply to prod.
--
-- Membership already lives on app_clients. Copilot settings hang
-- off client_code so a member's account is the same login they
-- already use on getapplydesk.com.
-- ═══════════════════════════════════════════════════════════════

-- ───────────── TABLES ─────────────

create table if not exists app_auto_apply_settings (
  client_code text primary key references app_clients(code) on delete cascade,
  enabled boolean not null default true,
  notify_on_new_matches boolean not null default true,
  min_match_pct int not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_job_pool (
  id bigint generated always as identity primary key,
  company text not null,
  title text not null,
  source text not null,
  url text not null,
  posted_at timestamptz,
  ats_type text,
  location text default '',
  description text default '',
  employment_type text default '',
  salary_text text default '',
  work_mode text default '',
  role_level text default '',
  years_required text default '',
  dedup_key text not null unique,
  verification_confidence numeric not null default 0.5,
  raw_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists app_job_matches (
  id bigint generated always as identity primary key,
  client_code text not null references app_clients(code) on delete cascade,
  job_id bigint not null references app_job_pool(id) on delete cascade,
  match_pct int not null default 0,
  matched_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (client_code, job_id)
);

create table if not exists app_tailored_drafts (
  id bigint generated always as identity primary key,
  match_id bigint not null references app_job_matches(id) on delete cascade,
  client_code text not null references app_clients(code) on delete cascade,
  diff_json jsonb,
  cover_letter_text text default '',
  resume_text text default '',
  filled_fields_json jsonb,
  llm_tokens_used int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists app_review_queue (
  id bigint generated always as identity primary key,
  draft_id bigint not null references app_tailored_drafts(id) on delete cascade,
  match_id bigint not null references app_job_matches(id) on delete cascade,
  client_code text not null references app_clients(code) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','edited')),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists app_submission_attempts (
  id bigint generated always as identity primary key,
  match_id bigint not null references app_job_matches(id) on delete cascade,
  review_id bigint references app_review_queue(id) on delete set null,
  client_code text not null references app_clients(code) on delete cascade,
  ats_type text,
  status text not null default 'queued_fill'
    check (status in (
      'queued_fill','dry_run_filled','awaiting_review',
      'queued_submit','submitted','failed',
      'paused_2fa','paused_captcha'
    )),
  failure_reason text,
  screenshot_url text,
  confirmation_id text,
  submitted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists app_copilot_profiles (
  client_code text primary key references app_clients(code) on delete cascade,
  full_name text default '',
  email text default '',
  phone text default '',
  location text default '',
  address text default '',
  education text default '',
  employment text default '',
  work_preference text default '',
  skills text default '',
  eeo_json jsonb default '{}'::jsonb,
  resume_text text default '',
  updated_at timestamptz not null default now()
);

create table if not exists app_client_email_connections (
  id bigint generated always as identity primary key,
  client_code text not null references app_clients(code) on delete cascade,
  provider text not null,
  connected_at timestamptz not null default now(),
  scope text,
  status text not null default 'connected'
    check (status in ('connected','revoked','expired')),
  unique (client_code, provider)
);

create index if not exists app_job_pool_posted_idx on app_job_pool (posted_at desc);
create index if not exists app_job_matches_client_idx on app_job_matches (client_code, matched_at desc);
create index if not exists app_review_queue_client_idx on app_review_queue (client_code, status, created_at desc);
create index if not exists app_submission_attempts_client_idx on app_submission_attempts (client_code, created_at desc);

alter table app_auto_apply_settings      enable row level security;
alter table app_job_pool                 enable row level security;
alter table app_job_matches              enable row level security;
alter table app_tailored_drafts          enable row level security;
alter table app_review_queue             enable row level security;
alter table app_submission_attempts      enable row level security;
alter table app_copilot_profiles          enable row level security;
alter table app_client_email_connections enable row level security;
-- No policies: same as existing tables. RPC only for authenticated users.
-- Service role (hourly workers) bypasses RLS.

-- ───────────── HELPERS ─────────────

create or replace function fn_a_copilot_client_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null then return null; end if;
  if v_me.role = 'client' then return v_me.role_code; end if;
  return null;
end $$;

-- ───────────── MEMBER SETTINGS ─────────────

create or replace function fn_a_enable_my_copilot()
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  insert into app_auto_apply_settings(client_code)
    values (v_code)
    on conflict (client_code) do update
      set enabled = true, updated_at = now();
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_get_my_copilot()
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_code text; v_settings record;
begin
  select * into v_me from fn_me();
  if v_me is null then return json_build_object('ok', false, 'err', 'not authenticated'); end if;
  v_code := case when v_me.role = 'client' then v_me.role_code else null end;
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;

  select * into v_settings from app_auto_apply_settings where client_code = v_code;
  return json_build_object(
    'ok', true,
    'settings', case when v_settings is null then null else row_to_json(v_settings) end,
    'new_matches', (select count(*) from app_job_matches m where m.client_code = v_code and m.notified_at is null),
    'pending_reviews', (select count(*) from app_review_queue q where q.client_code = v_code and q.status in ('pending','edited')),
    'queued_submits', (select count(*) from app_submission_attempts s where s.client_code = v_code and s.status in ('queued_fill','queued_submit','awaiting_review'))
  );
end $$;

-- ───────────── JOBS + MATCHES ─────────────

create or replace function fn_a_list_my_matches(p_limit int default 50, p_min_pct int default 0)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  return json_build_object('ok', true, 'matches', (
    select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
      select
        m.id, m.match_pct, m.matched_at, m.notified_at,
        j.id as job_id, j.company, j.title, j.source, j.url, j.posted_at,
        j.ats_type, j.location, left(j.description, 800) as description,
        j.employment_type, j.salary_text, j.work_mode, j.role_level, j.years_required,
        exists (
          select 1 from app_review_queue q
          where q.match_id = m.id and q.status in ('pending','edited','approved')
        ) as already_applying
      from app_job_matches m
      join app_job_pool j on j.id = m.job_id
      where m.client_code = v_code
        and m.match_pct >= coalesce(p_min_pct, 0)
      order by m.matched_at desc, m.match_pct desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ));
end $$;

create or replace function fn_a_mark_matches_seen()
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  update app_job_matches set notified_at = now()
    where client_code = v_code and notified_at is null;
  return json_build_object('ok', true);
end $$;

-- Admin/manager can inspect the ingested pool (no client PII).
create or replace function fn_a_list_job_pool(p_limit int default 50)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then
    return json_build_object('ok', false, 'err', 'not allowed');
  end if;
  return json_build_object('ok', true, 'jobs', (
    select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
      select id, company, title, source, url, posted_at, ats_type, location, created_at
      from app_job_pool
      order by coalesce(posted_at, created_at) desc
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ));
end $$;

-- ───────────── APPLY → REVIEW ─────────────

create or replace function fn_a_start_apply(p_match_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_match record;
  v_draft_id bigint;
  v_review_id bigint;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;

  select m.*, j.ats_type, j.company, j.title, j.url
    into v_match
    from app_job_matches m
    join app_job_pool j on j.id = m.job_id
   where m.id = p_match_id and m.client_code = v_code;
  if not found then return json_build_object('ok', false, 'err', 'not found'); end if;

  if exists (
    select 1 from app_review_queue q
     where q.match_id = p_match_id and q.status in ('pending','edited','approved')
  ) then
    select q.id into v_review_id from app_review_queue q
      where q.match_id = p_match_id and q.client_code = v_code
      order by q.created_at desc limit 1;
    return json_build_object('ok', true, 'review_id', v_review_id, 'already', true);
  end if;

  insert into app_tailored_drafts(match_id, client_code, diff_json, cover_letter_text, filled_fields_json)
    values (p_match_id, v_code, '{}'::jsonb, '', '{}'::jsonb)
    returning id into v_draft_id;

  insert into app_review_queue(draft_id, match_id, client_code, status)
    values (v_draft_id, p_match_id, v_code, 'pending')
    returning id into v_review_id;

  insert into app_submission_attempts(match_id, review_id, client_code, ats_type, status)
    values (p_match_id, v_review_id, v_code, v_match.ats_type, 'queued_fill');

  return json_build_object('ok', true, 'review_id', v_review_id, 'draft_id', v_draft_id);
end $$;

create or replace function fn_a_list_my_reviews(p_status text default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  if p_status is not null and p_status not in ('pending','approved','rejected','edited') then
    return json_build_object('ok', false, 'err', 'bad status');
  end if;
  return json_build_object('ok', true, 'reviews', (
    select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
      select
        q.id, q.status, q.created_at, q.reviewed_at,
        d.id as draft_id, d.cover_letter_text, d.diff_json, d.filled_fields_json, d.resume_text,
        m.id as match_id, m.match_pct,
        j.company, j.title, j.url, j.ats_type, j.location, j.source,
        left(j.description, 1200) as description
      from app_review_queue q
      join app_tailored_drafts d on d.id = q.draft_id
      join app_job_matches m on m.id = q.match_id
      join app_job_pool j on j.id = m.job_id
      where q.client_code = v_code
        and (p_status is null or q.status = p_status)
      order by q.created_at desc
      limit 100
    ) x
  ));
end $$;

create or replace function fn_a_save_review(
  p_review_id bigint,
  p_cover_letter text default null,
  p_filled_fields_json jsonb default null,
  p_resume_text text default null
)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; v_draft bigint;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  select draft_id into v_draft from app_review_queue
    where id = p_review_id and client_code = v_code and status in ('pending','edited');
  if v_draft is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  update app_tailored_drafts set
    cover_letter_text = coalesce(p_cover_letter, cover_letter_text),
    filled_fields_json = coalesce(p_filled_fields_json, filled_fields_json),
    resume_text = coalesce(p_resume_text, resume_text)
  where id = v_draft;
  update app_review_queue set status = 'edited', reviewed_at = now()
    where id = p_review_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_confirm_submit(p_review_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; v_match bigint; v_ats text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  select q.match_id into v_match
    from app_review_queue q
   where q.id = p_review_id and q.client_code = v_code and q.status in ('pending','edited');
  if v_match is null then return json_build_object('ok', false, 'err', 'not found'); end if;

  select j.ats_type into v_ats
    from app_job_matches m join app_job_pool j on j.id = m.job_id
   where m.id = v_match;

  update app_review_queue
     set status = 'approved', reviewed_at = now()
   where id = p_review_id;

  insert into app_submission_attempts(match_id, review_id, client_code, ats_type, status)
    values (v_match, p_review_id, v_code, v_ats, 'queued_submit');

  return json_build_object('ok', true, 'queued', true);
end $$;

create or replace function fn_a_reject_review(p_review_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  update app_review_queue
     set status = 'rejected', reviewed_at = now()
   where id = p_review_id and client_code = v_code and status in ('pending','edited');
  if not found then return json_build_object('ok', false, 'err', 'not found'); end if;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_list_my_submissions()
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  return json_build_object('ok', true, 'attempts', (
    select coalesce(json_agg(row_to_json(x)), '[]'::json) from (
      select
        s.id, s.status, s.failure_reason, s.screenshot_url, s.confirmation_id,
        s.ats_type, s.submitted_at, s.created_at,
        j.company, j.title, j.url, j.location, j.employment_type, j.salary_text, j.work_mode,
        d.resume_text, d.cover_letter_text, m.match_pct
      from app_submission_attempts s
      join app_job_matches m on m.id = s.match_id
      join app_job_pool j on j.id = m.job_id
      left join app_review_queue q on q.id = s.review_id
      left join app_tailored_drafts d on d.id = q.draft_id
      where s.client_code = v_code
      order by s.created_at desc
      limit 100
    ) x
  ));
end $$;

create or replace function fn_a_get_my_copilot_profile()
returns json language plpgsql security definer set search_path = public as $$
declare v_code text; v_row record;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  select * into v_row from app_copilot_profiles where client_code = v_code;
  if not found then
    return json_build_object('ok', true, 'profile', json_build_object('client_code', v_code));
  end if;
  return json_build_object('ok', true, 'profile', row_to_json(v_row));
end $$;

create or replace function fn_a_save_my_copilot_profile(
  p_full_name text default null,
  p_email text default null,
  p_phone text default null,
  p_location text default null,
  p_address text default null,
  p_education text default null,
  p_employment text default null,
  p_work_preference text default null,
  p_skills text default null,
  p_eeo_json jsonb default null,
  p_resume_text text default null
)
returns json language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  v_code := fn_a_copilot_client_code();
  if v_code is null then return json_build_object('ok', false, 'err', 'clients only'); end if;
  insert into app_copilot_profiles as p (
    client_code, full_name, email, phone, location, address, education, employment,
    work_preference, skills, eeo_json, resume_text, updated_at
  ) values (
    v_code,
    coalesce(p_full_name,''), coalesce(p_email,''), coalesce(p_phone,''),
    coalesce(p_location,''), coalesce(p_address,''), coalesce(p_education,''),
    coalesce(p_employment,''), coalesce(p_work_preference,''), coalesce(p_skills,''),
    coalesce(p_eeo_json, '{}'::jsonb), coalesce(p_resume_text,''), now()
  )
  on conflict (client_code) do update set
    full_name = coalesce(p_full_name, p.full_name),
    email = coalesce(p_email, p.email),
    phone = coalesce(p_phone, p.phone),
    location = coalesce(p_location, p.location),
    address = coalesce(p_address, p.address),
    education = coalesce(p_education, p.education),
    employment = coalesce(p_employment, p.employment),
    work_preference = coalesce(p_work_preference, p.work_preference),
    skills = coalesce(p_skills, p.skills),
    eeo_json = coalesce(p_eeo_json, p.eeo_json),
    resume_text = coalesce(p_resume_text, p.resume_text),
    updated_at = now();
  return json_build_object('ok', true);
end $$;

-- ───────────── GRANTS ─────────────

grant execute on function
  fn_a_enable_my_copilot(),
  fn_a_get_my_copilot(),
  fn_a_list_my_matches(int, int),
  fn_a_mark_matches_seen(),
  fn_a_list_job_pool(int),
  fn_a_start_apply(bigint),
  fn_a_list_my_reviews(text),
  fn_a_save_review(bigint, text, jsonb, text),
  fn_a_confirm_submit(bigint),
  fn_a_reject_review(bigint),
  fn_a_list_my_submissions(),
  fn_a_get_my_copilot_profile(),
  fn_a_save_my_copilot_profile(text,text,text,text,text,text,text,text,text,jsonb,text)
to authenticated;

revoke execute on function fn_a_copilot_client_code() from anon, authenticated;
