-- ═══════════════════════════════════════════════════════
-- APPLYDESK MISSION CONTROL - DATABASE SCHEMA v1
-- Paste this entire file into Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════════════════

-- ---------- TABLES ----------
create table if not exists app_admin (
  code text primary key
);

create table if not exists app_clients (
  code text primary key,
  name text not null,
  target int not null default 25
);

create table if not exists app_recruiters (
  code text primary key,
  name text not null,
  assigned text[] not null default '{}'
);

create table if not exists app_managers (
  code text primary key,
  name text not null
);

create table if not exists app_records (
  id bigint generated always as identity primary key,
  client_code text not null,
  type text not null check (type in ('application','reachout')),
  date date not null default current_date,
  company text not null,
  role text default '',
  link text default '',
  recruiter_name text default '',
  recruiter_email text default '',
  replied text default '',
  notes text default '',
  resume_link text default '',
  resume_file text default '',
  added_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists app_messages (
  id bigint generated always as identity primary key,
  client_code text not null,
  from_role text not null check (from_role in ('client','team')),
  by_code text not null,
  body text not null,
  ts timestamptz not null default now()
);

create table if not exists app_resumes (
  record_id bigint primary key references app_records(id) on delete cascade,
  file_name text not null,
  data text not null
);

-- Initial admin code (change anytime with:
--   update app_admin set code = 'NEW-CODE';)
insert into app_admin(code) values ('vtproton@22')
on conflict do nothing;

-- ---------- LOCK EVERYTHING DOWN ----------
alter table app_admin      enable row level security;
alter table app_clients    enable row level security;
alter table app_recruiters enable row level security;
alter table app_managers   enable row level security;
alter table app_records    enable row level security;
alter table app_messages   enable row level security;
alter table app_resumes    enable row level security;
-- No policies created on purpose: anon/authenticated get ZERO direct
-- table access. The ONLY doorway is the functions below, which verify
-- the caller's access code on every call.

-- ---------- HELPERS ----------
create or replace function fn_role(p_code text)
returns table(role text, display_name text)
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from app_admin a where a.code = p_code) then
    return query select 'admin'::text, 'Admin'::text; return;
  end if;
  if exists (select 1 from app_managers m where m.code = p_code) then
    return query select 'manager'::text, (select m.name from app_managers m where m.code = p_code); return;
  end if;
  if exists (select 1 from app_recruiters r where r.code = p_code) then
    return query select 'recruiter'::text, (select r.name from app_recruiters r where r.code = p_code); return;
  end if;
  if exists (select 1 from app_clients c where c.code = p_code) then
    return query select 'client'::text, (select c.name from app_clients c where c.code = p_code); return;
  end if;
  return;
end $$;

create or replace function fn_team_name(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if exists (select 1 from app_admin where code = p_code) then return 'Admin'; end if;
  select name || ' (Ops)' into v from app_managers where code = p_code;
  if v is not null then return v; end if;
  select name into v from app_recruiters where code = p_code;
  if v is not null then return v; end if;
  return 'Team';
end $$;

-- ---------- LOGIN + STATE ----------
create or replace function fn_login(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text;
begin
  select role, display_name into v_role, v_name from fn_role(p_code);
  if v_role is null then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'role', v_role, 'name', v_name);
end $$;

create or replace function fn_get_state(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_name text; v_assigned text[]; result json;
begin
  select role, display_name into v_role, v_name from fn_role(p_code);
  if v_role is null then return json_build_object('ok', false); end if;

  if v_role in ('admin','manager') then
    result := json_build_object(
      'ok', true, 'role', v_role, 'name', v_name,
      'clients',    (select coalesce(json_agg(row_to_json(c)), '[]'::json) from app_clients c),
      'recruiters', case when v_role = 'admin'
                      then (select coalesce(json_agg(row_to_json(r)), '[]'::json) from app_recruiters r)
                      else '[]'::json end,
      'managers',   case when v_role = 'admin'
                      then (select coalesce(json_agg(row_to_json(m)), '[]'::json) from app_managers m)
                      else '[]'::json end,
      'records',    (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x),
      'messages',   (select coalesce(json_agg(json_build_object(
                        'id', g.id, 'client_code', g.client_code, 'from_role', g.from_role,
                        'by_name', case when g.from_role = 'client'
                                     then coalesce((select name from app_clients where code = g.by_code), 'Client')
                                     else fn_team_name(g.by_code) end,
                        'body', g.body, 'ts', g.ts) order by g.ts), '[]'::json)
                     from app_messages g)
    );
  elsif v_role = 'recruiter' then
    select assigned into v_assigned from app_recruiters where code = p_code;
    result := json_build_object(
      'ok', true, 'role', v_role, 'name', v_name,
      'clients',  (select coalesce(json_agg(row_to_json(c)), '[]'::json) from app_clients c where c.code = any(v_assigned)),
      'records',  (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x where x.client_code = any(v_assigned)),
      'messages', (select coalesce(json_agg(json_build_object(
                      'id', g.id, 'client_code', g.client_code, 'from_role', g.from_role,
                      'by_name', case when g.from_role = 'client'
                                   then coalesce((select name from app_clients where code = g.by_code), 'Client')
                                   else fn_team_name(g.by_code) end,
                      'body', g.body, 'ts', g.ts) order by g.ts), '[]'::json)
                   from app_messages g where g.client_code = any(v_assigned))
    );
  else -- client
    result := json_build_object(
      'ok', true, 'role', v_role, 'name', v_name,
      'me',       (select row_to_json(c) from app_clients c where c.code = p_code),
      'records',  (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x where x.client_code = p_code),
      'messages', (select coalesce(json_agg(json_build_object(
                      'id', g.id, 'from_role', g.from_role,
                      'by_name', case when g.from_role = 'client'
                                   then coalesce((select name from app_clients where code = g.by_code), 'You')
                                   else fn_team_name(g.by_code) end,
                      'body', g.body, 'ts', g.ts) order by g.ts), '[]'::json)
                   from app_messages g where g.client_code = p_code)
    );
  end if;
  return result;
end $$;

-- ---------- ADMIN ACCOUNT MANAGEMENT ----------
create or replace function fn_add_client(p_actor text, p_name text, p_code text, p_target int)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from fn_role(p_code)) then return json_build_object('ok', false, 'err', 'code in use'); end if;
  insert into app_clients(code, name, target) values (p_code, p_name, greatest(1, coalesce(p_target, 25)));
  return json_build_object('ok', true);
end $$;

create or replace function fn_del_client(p_actor text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  delete from app_clients where code = p_code;
  update app_recruiters set assigned = array_remove(assigned, p_code);
  return json_build_object('ok', true);
end $$;

create or replace function fn_add_recruiter(p_actor text, p_name text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from fn_role(p_code)) then return json_build_object('ok', false, 'err', 'code in use'); end if;
  insert into app_recruiters(code, name) values (p_code, p_name);
  return json_build_object('ok', true);
end $$;

create or replace function fn_del_recruiter(p_actor text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  delete from app_recruiters where code = p_code;
  return json_build_object('ok', true);
end $$;

create or replace function fn_toggle_assign(p_actor text, p_recruiter text, p_client text)
returns json language plpgsql security definer set search_path = public as $$
declare v_assigned text[];
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  select assigned into v_assigned from app_recruiters where code = p_recruiter;
  if v_assigned is null then return json_build_object('ok', false, 'err', 'no recruiter'); end if;
  if p_client = any(v_assigned) then
    update app_recruiters set assigned = array_remove(assigned, p_client) where code = p_recruiter;
  else
    update app_recruiters set assigned = array_append(assigned, p_client) where code = p_recruiter;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function fn_add_manager(p_actor text, p_name text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from fn_role(p_code)) then return json_build_object('ok', false, 'err', 'code in use'); end if;
  insert into app_managers(code, name) values (p_code, p_name);
  return json_build_object('ok', true);
end $$;

create or replace function fn_del_manager(p_actor text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  delete from app_managers where code = p_code;
  return json_build_object('ok', true);
end $$;

-- ---------- RECORD PERMISSION HELPER ----------
create or replace function fn_can_touch_client(p_actor text, p_client text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role in ('admin','manager') then return true; end if;
  if v_role = 'recruiter' then
    return exists (select 1 from app_recruiters r where r.code = p_actor and p_client = any(r.assigned));
  end if;
  return false;
end $$;

-- ---------- RECORDS ----------
create or replace function fn_add_record(
  p_actor text, p_client text, p_type text, p_date date,
  p_company text, p_role text, p_link text,
  p_rname text, p_remail text, p_replied text,
  p_notes text, p_resume_link text)
returns json language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not fn_can_touch_client(p_actor, p_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  insert into app_records(client_code, type, date, company, role, link,
    recruiter_name, recruiter_email, replied, notes, resume_link, added_by)
  values (p_client, p_type, coalesce(p_date, current_date), p_company, coalesce(p_role,''), coalesce(p_link,''),
    coalesce(p_rname,''), coalesce(p_remail,''), coalesce(p_replied,''), coalesce(p_notes,''), coalesce(p_resume_link,''), p_actor)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

create or replace function fn_del_record(p_actor text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text;
begin
  select client_code into v_client from app_records where id = p_id;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if not fn_can_touch_client(p_actor, v_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  delete from app_records where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_toggle_reply(p_actor text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text;
begin
  select client_code into v_client from app_records where id = p_id;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if not fn_can_touch_client(p_actor, v_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  update app_records set replied = case when replied = 'yes' then 'no' else 'yes' end where id = p_id;
  return json_build_object('ok', true);
end $$;

-- ---------- MESSAGES ----------
create or replace function fn_send_message(p_actor text, p_client text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role is null or length(trim(p_body)) = 0 then return json_build_object('ok', false, 'err', 'invalid'); end if;
  if v_role = 'client' then
    if p_actor <> p_client then return json_build_object('ok', false, 'err', 'not allowed'); end if;
    insert into app_messages(client_code, from_role, by_code, body) values (p_client, 'client', p_actor, trim(p_body));
  else
    if not fn_can_touch_client(p_actor, p_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
    insert into app_messages(client_code, from_role, by_code, body) values (p_client, 'team', p_actor, trim(p_body));
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- RESUMES (base64, max ~1MB) ----------
create or replace function fn_save_resume(p_actor text, p_record bigint, p_name text, p_data text)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text;
begin
  select client_code into v_client from app_records where id = p_record;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if not fn_can_touch_client(p_actor, v_client) then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if length(p_data) > 1600000 then return json_build_object('ok', false, 'err', 'too big'); end if;
  insert into app_resumes(record_id, file_name, data) values (p_record, p_name, p_data)
    on conflict (record_id) do update set file_name = excluded.file_name, data = excluded.data;
  update app_records set resume_file = p_name where id = p_record;
  return json_build_object('ok', true);
end $$;

create or replace function fn_get_resume(p_actor text, p_record bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_client text; v_role text;
begin
  select client_code into v_client from app_records where id = p_record;
  if v_client is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  select role into v_role from fn_role(p_actor);
  if v_role = 'client' and p_actor = v_client then null;       -- client downloading own resume: ok
  elsif fn_can_touch_client(p_actor, v_client) then null;      -- team with access: ok
  else return json_build_object('ok', false, 'err', 'not allowed');
  end if;
  return (select json_build_object('ok', true, 'name', r.file_name, 'data', r.data) from app_resumes r where r.record_id = p_record);
end $$;

-- ---------- PERMISSIONS ----------
revoke all on all tables in schema public from anon, authenticated;
grant execute on function
  fn_login(text), fn_get_state(text),
  fn_add_client(text,text,text,int), fn_del_client(text,text),
  fn_add_recruiter(text,text,text), fn_del_recruiter(text,text),
  fn_toggle_assign(text,text,text),
  fn_add_manager(text,text,text), fn_del_manager(text,text),
  fn_add_record(text,text,text,date,text,text,text,text,text,text,text,text),
  fn_del_record(text,bigint), fn_toggle_reply(text,bigint),
  fn_send_message(text,text,text),
  fn_save_resume(text,bigint,text,text), fn_get_resume(text,bigint)
to anon;
-- Internal helpers stay unexposed:
revoke execute on function fn_role(text), fn_team_name(text), fn_can_touch_client(text,text) from anon, authenticated;
