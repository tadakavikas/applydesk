-- ═══════════════════════════════════════════════════════════════
-- APPLYDESK PATCH 5: SUPABASE AUTH MIGRATION - STEP 1 OF 2
--
-- What this does:
--   Adds email columns to every role table.
--   Creates a mapping between Supabase's auth.users and our role rows.
--   Adds a new resolver that reads the caller's identity from the JWT
--   instead of trusting a code passed in a parameter.
--   Keeps old code-based functions working so nothing breaks mid-migration.
--
-- Safe to run: uses IF NOT EXISTS everywhere, does not delete anything.
-- Paste the whole file into Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════════════


-- ───────────── PART A: SCHEMA CHANGES ─────────────
-- Each role table gets an email column. This is how we'll match
-- Supabase auth.users (which are keyed by email) to our role rows.

alter table app_admin      add column if not exists email text;
alter table app_managers   add column if not exists email text;
alter table app_recruiters add column if not exists email text;
alter table app_clients    add column if not exists email text;


-- The mapping table: one row per authenticated user, pointing at
-- their role and role-row. Supabase auth.users.id is a UUID. Every
-- function will use this table to answer "who is this JWT-carrying
-- user, and what can they do?"

create table if not exists app_auth_map (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','manager','recruiter','client')),
  role_code text not null,        -- the existing code in app_admin/app_managers/etc.
  created_at timestamptz not null default now()
);

-- Fast lookup by role_code (used during migration and reassignments)
create index if not exists app_auth_map_role_code_idx
  on app_auth_map(role, role_code);

-- RLS locked: no one can read this table directly. Only our
-- SECURITY DEFINER functions can, and they resolve auth.uid() only.
alter table app_auth_map enable row level security;


-- ───────────── PART B: NEW RESOLVER ─────────────
-- fn_me() replaces the old fn_role(p_code text) pattern.
-- It reads auth.uid() from the JWT that Supabase attaches to every
-- authenticated request. If there's no JWT (public/anon request),
-- auth.uid() returns null and we deny the operation.

create or replace function fn_me()
returns table(user_id uuid, role text, role_code text, display_name text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_map record;
begin
  if v_uid is null then
    return;  -- returns zero rows, caller treats as unauthenticated
  end if;

  select * into v_map from app_auth_map where app_auth_map.user_id = v_uid;
  if not found then
    return;
  end if;

  if v_map.role = 'admin' then
    return query select v_uid, 'admin'::text, v_map.role_code, 'Admin'::text;
  elsif v_map.role = 'manager' then
    return query select v_uid, 'manager'::text, v_map.role_code,
      (select name from app_managers where code = v_map.role_code);
  elsif v_map.role = 'recruiter' then
    return query select v_uid, 'recruiter'::text, v_map.role_code,
      (select name from app_recruiters where code = v_map.role_code);
  elsif v_map.role = 'client' then
    return query select v_uid, 'client'::text, v_map.role_code,
      (select name from app_clients where code = v_map.role_code);
  end if;
end $$;


-- Simple wrapper the portal can call once at login to get "who am I?"
create or replace function fn_whoami()
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null then
    return json_build_object('ok', false, 'err', 'not authenticated');
  end if;
  return json_build_object('ok', true, 'role', v_me.role, 'name', v_me.display_name);
end $$;


-- ───────────── PART C: AUTH-BASED FUNCTIONS ─────────────
-- Each of these mirrors an existing code-based function, but takes
-- NO p_actor parameter. Identity comes from the JWT. Nothing to spoof.
--
-- Naming convention: fn_a_XXX for auth-based versions.
-- Old fn_XXX code-based versions remain, so both worlds work during cutover.


-- ── GET STATE (all data the current user is allowed to see) ──
create or replace function fn_a_get_state()
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_assigned text[]; result json;
begin
  select * into v_me from fn_me();
  if v_me is null then return json_build_object('ok', false, 'err', 'not authenticated'); end if;

  if v_me.role in ('admin','manager') then
    result := json_build_object(
      'ok', true, 'role', v_me.role, 'name', v_me.display_name, 'code', v_me.role_code,
      'clients',    (select coalesce(json_agg(row_to_json(c)), '[]'::json) from app_clients c),
      'recruiters', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from app_recruiters r),
      'managers',   case when v_me.role = 'admin'
                      then (select coalesce(json_agg(row_to_json(m)), '[]'::json) from app_managers m)
                      else (select coalesce(json_agg(json_build_object('code', m.code, 'name', m.name, 'email', m.email)), '[]'::json) from app_managers m) end,
      'records',    (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x),
      'messages',   (select coalesce(json_agg(json_build_object(
                        'id', g.id, 'client_code', g.client_code, 'from_role', g.from_role,
                        'by_code', g.by_code,
                        'by_name', case when g.from_role = 'client'
                                     then coalesce((select name from app_clients where code = g.by_code), 'Client')
                                     else fn_team_name(g.by_code) end,
                        'body', g.body, 'ts', g.ts, 'edited_at', g.edited_at) order by g.ts), '[]'::json)
                     from app_messages g)
    );
  elsif v_me.role = 'recruiter' then
    select assigned into v_assigned from app_recruiters where code = v_me.role_code;
    result := json_build_object(
      'ok', true, 'role', v_me.role, 'name', v_me.display_name, 'code', v_me.role_code,
      'clients',  (select coalesce(json_agg(row_to_json(c)), '[]'::json) from app_clients c where c.code = any(v_assigned)),
      'records',  (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x where x.client_code = any(v_assigned)),
      'messages', (select coalesce(json_agg(json_build_object(
                      'id', g.id, 'client_code', g.client_code, 'from_role', g.from_role,
                      'by_code', g.by_code,
                      'by_name', case when g.from_role = 'client'
                                   then coalesce((select name from app_clients where code = g.by_code), 'Client')
                                   else fn_team_name(g.by_code) end,
                      'body', g.body, 'ts', g.ts, 'edited_at', g.edited_at) order by g.ts), '[]'::json)
                   from app_messages g where g.client_code = any(v_assigned))
    );
  else -- client
    result := json_build_object(
      'ok', true, 'role', v_me.role, 'name', v_me.display_name, 'code', v_me.role_code,
      'me',       (select row_to_json(c) from app_clients c where c.code = v_me.role_code),
      'records',  (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x where x.client_code = v_me.role_code),
      'messages', (select coalesce(json_agg(json_build_object(
                      'id', g.id, 'from_role', g.from_role, 'by_code', g.by_code,
                      'by_name', case when g.from_role = 'client'
                                   then coalesce((select name from app_clients where code = g.by_code), 'You')
                                   else fn_team_name(g.by_code) end,
                      'body', g.body, 'ts', g.ts, 'edited_at', g.edited_at) order by g.ts), '[]'::json)
                   from app_messages g where g.client_code = v_me.role_code)
    );
  end if;
  return result;
end $$;


-- ── ADMIN + MANAGER: ACCOUNT MANAGEMENT ──
create or replace function fn_a_add_client(p_name text, p_code text, p_target int, p_email text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from app_admin where code = p_code)
     or exists (select 1 from app_managers where code = p_code)
     or exists (select 1 from app_recruiters where code = p_code)
     or exists (select 1 from app_clients where code = p_code) then
    return json_build_object('ok', false, 'err', 'code in use');
  end if;
  insert into app_clients(code, name, target, email)
    values (p_code, p_name, greatest(1, coalesce(p_target, 25)), p_email);
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_del_client(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  delete from app_records  where client_code = p_code;
  delete from app_messages where client_code = p_code;
  delete from app_clients  where code = p_code;
  update app_recruiters set assigned = array_remove(assigned, p_code);
  delete from app_auth_map where role = 'client' and role_code = p_code;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_add_recruiter(p_name text, p_code text, p_email text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from app_admin where code = p_code)
     or exists (select 1 from app_managers where code = p_code)
     or exists (select 1 from app_recruiters where code = p_code)
     or exists (select 1 from app_clients where code = p_code) then
    return json_build_object('ok', false, 'err', 'code in use');
  end if;
  insert into app_recruiters(code, name, email) values (p_code, p_name, p_email);
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_del_recruiter(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  delete from app_recruiters where code = p_code;
  delete from app_auth_map where role = 'recruiter' and role_code = p_code;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_toggle_assign(p_recruiter text, p_client text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_assigned text[];
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  select assigned into v_assigned from app_recruiters where code = p_recruiter;
  if v_assigned is null then return json_build_object('ok', false, 'err', 'no recruiter'); end if;
  if p_client = any(v_assigned) then
    update app_recruiters set assigned = array_remove(assigned, p_client) where code = p_recruiter;
  else
    update app_recruiters set assigned = array_append(assigned, p_client) where code = p_recruiter;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_add_manager(p_name text, p_code text, p_email text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  if exists (select 1 from app_admin where code = p_code)
     or exists (select 1 from app_managers where code = p_code)
     or exists (select 1 from app_recruiters where code = p_code)
     or exists (select 1 from app_clients where code = p_code) then
    return json_build_object('ok', false, 'err', 'code in use');
  end if;
  insert into app_managers(code, name, email) values (p_code, p_name, p_email);
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_del_manager(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  delete from app_managers where code = p_code;
  delete from app_auth_map where role = 'manager' and role_code = p_code;
  return json_build_object('ok', true);
end $$;


-- ── PERMISSION HELPER (auth version) ──
create or replace function fn_a_can_touch_client(p_client text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null then return false; end if;
  if v_me.role in ('admin','manager') then return true; end if;
  if v_me.role = 'recruiter' then
    return exists (select 1 from app_recruiters r
                    where r.code = v_me.role_code and p_client = any(r.assigned));
  end if;
  return false;
end $$;


-- ── RECORDS ──
create or replace function fn_a_add_record(
  p_client text, p_type text, p_date date,
  p_company text, p_role text, p_link text,
  p_rname text, p_remail text, p_replied text,
  p_notes text, p_resume_link text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_id bigint;
begin
  select * into v_me from fn_me();
  if v_me is null then return json_build_object('ok', false, 'err', 'not authenticated'); end if;
  if not fn_a_can_touch_client(p_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  insert into app_records(client_code, type, date, company, role, link,
    recruiter_name, recruiter_email, replied, notes, resume_link, added_by)
  values (p_client, p_type, coalesce(p_date, current_date), p_company, coalesce(p_role,''),
    coalesce(p_link,''), coalesce(p_rname,''), coalesce(p_remail,''), coalesce(p_replied,''),
    coalesce(p_notes,''), coalesce(p_resume_link,''), v_me.role_code)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function fn_a_del_record(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text;
begin
  select client_code into v_client from app_records where id = p_id;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if not fn_a_can_touch_client(v_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  delete from app_records where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_toggle_reply(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text;
begin
  select client_code into v_client from app_records where id = p_id;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if not fn_a_can_touch_client(v_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  update app_records set replied = case when replied = 'yes' then 'no' else 'yes' end where id = p_id;
  return json_build_object('ok', true);
end $$;


-- ── MESSAGES ──
create or replace function fn_a_send_message(p_client text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or length(trim(p_body)) = 0 then return json_build_object('ok', false, 'err', 'invalid'); end if;
  if v_me.role = 'client' then
    if v_me.role_code <> p_client then return json_build_object('ok', false, 'err', 'not allowed'); end if;
    insert into app_messages(client_code, from_role, by_code, body)
      values (p_client, 'client', v_me.role_code, trim(p_body));
  else
    if not fn_a_can_touch_client(p_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
    insert into app_messages(client_code, from_role, by_code, body)
      values (p_client, 'team', v_me.role_code, trim(p_body));
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_edit_message(p_id bigint, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_by text; v_ts timestamptz;
begin
  select * into v_me from fn_me();
  if v_me is null or length(trim(coalesce(p_body,''))) = 0 then return json_build_object('ok', false, 'err', 'invalid'); end if;
  select by_code, ts into v_by, v_ts from app_messages where id = p_id;
  if v_by is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if v_by <> v_me.role_code then return json_build_object('ok', false, 'err', 'not your message'); end if;
  if v_ts < now() - interval '5 minutes' then return json_build_object('ok', false, 'err', '5 minute edit window expired'); end if;
  update app_messages set body = trim(p_body), edited_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_del_message(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  delete from app_messages where id = p_id;
  return json_build_object('ok', true);
end $$;


-- ── RESUMES ──
create or replace function fn_a_save_resume(p_record bigint, p_name text, p_data text)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text;
begin
  select client_code into v_client from app_records where id = p_record;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if not fn_a_can_touch_client(v_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if length(p_data) > 1600000 then return json_build_object('ok', false, 'err', 'too big'); end if;
  insert into app_resumes(record_id, file_name, data) values (p_record, p_name, p_data)
    on conflict (record_id) do update set file_name = excluded.file_name, data = excluded.data;
  update app_records set resume_file = p_name where id = p_record;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_get_resume(p_record bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_client text;
begin
  select * into v_me from fn_me();
  if v_me is null then return json_build_object('ok', false, 'err', 'not authenticated'); end if;
  select client_code into v_client from app_records where id = p_record;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if v_me.role = 'client' and v_me.role_code = v_client then null;
  elsif fn_a_can_touch_client(v_client) then null;
  else return json_build_object('ok', false, 'err', 'not allowed');
  end if;
  return (select json_build_object('ok', true, 'name', r.file_name, 'data', r.data)
          from app_resumes r where r.record_id = p_record);
end $$;


-- ── LEADS ──
create or replace function fn_a_get_leads()
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  return json_build_object('ok', true, 'leads',
    (select coalesce(json_agg(json_build_object(
      'id', l.id, 'first_name', l.first_name, 'last_name', l.last_name,
      'email', l.email, 'phone', l.phone, 'plan', l.plan, 'status', l.status,
      'source', l.source, 'created_at', l.created_at,
      'claimed_by', l.claimed_by, 'claimed_at', l.claimed_at,
      'claimed_by_name', case when l.claimed_by is null then null else fn_team_name(l.claimed_by) end
    ) order by l.created_at desc), '[]'::json) from app_leads l));
end $$;

create or replace function fn_a_claim_lead(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_current text;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'only managers can claim'); end if;
  select claimed_by into v_current from app_leads where id = p_id;
  if v_current is not null and v_me.role <> 'admin' then
    return json_build_object('ok', false, 'err', 'already claimed');
  end if;
  update app_leads set claimed_by = v_me.role_code, claimed_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_reassign_lead(p_id bigint, p_new_owner text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_new_role text;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  if p_new_owner is null or p_new_owner = '' then
    update app_leads set claimed_by = null, claimed_at = null where id = p_id;
  else
    select role into v_new_role from fn_role(p_new_owner);
    if v_new_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'invalid owner'); end if;
    update app_leads set claimed_by = p_new_owner, claimed_at = now() where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_set_lead_status(p_id bigint, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_owner text;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if p_status not in ('new','contacted','closed') then return json_build_object('ok', false, 'err', 'bad status'); end if;
  select claimed_by into v_owner from app_leads where id = p_id;
  if v_me.role <> 'admin' and (v_owner is null or v_owner <> v_me.role_code) then
    return json_build_object('ok', false, 'err', 'claim it first');
  end if;
  update app_leads set status = p_status where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_del_lead(p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  delete from app_leads where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_a_create_lead(p_first text, p_last text, p_email text, p_phone text, p_plan text, p_source text)
returns json language plpgsql security definer set search_path = public as $$
declare v_me record; v_id bigint;
begin
  select * into v_me from fn_me();
  if v_me is null or v_me.role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if length(trim(coalesce(p_first,''))) = 0 or length(trim(coalesce(p_email,''))) = 0
     or length(trim(coalesce(p_phone,''))) = 0 or length(trim(coalesce(p_plan,''))) = 0 then
    return json_build_object('ok', false, 'err', 'first name, email, phone, and plan are required');
  end if;
  insert into app_leads(first_name, last_name, email, phone, plan, source, claimed_by, claimed_at)
    values (trim(p_first), trim(coalesce(p_last,'')), trim(p_email), trim(p_phone),
            trim(p_plan), coalesce(nullif(trim(p_source),''),'manual'), v_me.role_code, now())
    returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;


-- ───────────── PART D: PERMISSIONS ─────────────
-- These grants let authenticated users (anyone with a valid JWT) call
-- the fn_a_* functions. The functions themselves check role internally.
-- The old fn_* functions stay granted to anon too, so both old and new
-- clients can work during cutover.

grant execute on function fn_whoami() to authenticated;
grant execute on function fn_a_get_state() to authenticated;
grant execute on function
  fn_a_add_client(text,text,int,text), fn_a_del_client(text),
  fn_a_add_recruiter(text,text,text), fn_a_del_recruiter(text),
  fn_a_toggle_assign(text,text),
  fn_a_add_manager(text,text,text), fn_a_del_manager(text),
  fn_a_add_record(text,text,date,text,text,text,text,text,text,text,text),
  fn_a_del_record(bigint), fn_a_toggle_reply(bigint),
  fn_a_send_message(text,text), fn_a_edit_message(bigint,text), fn_a_del_message(bigint),
  fn_a_save_resume(bigint,text,text), fn_a_get_resume(bigint),
  fn_a_get_leads(), fn_a_claim_lead(bigint), fn_a_reassign_lead(bigint,text),
  fn_a_set_lead_status(bigint,text), fn_a_del_lead(bigint),
  fn_a_create_lead(text,text,text,text,text,text)
to authenticated;

-- Helpers stay unexposed
revoke execute on function fn_me(), fn_a_can_touch_client(text) from anon, authenticated;
