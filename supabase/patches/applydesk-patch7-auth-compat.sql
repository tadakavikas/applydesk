-- ═══════════════════════════════════════════════════════════════
-- APPLYDESK PATCH 7: DROP-IN COMPATIBLE AUTH FUNCTIONS
--
-- Makes fn_a_add_* accept the same parameters as legacy fn_add_*
-- so the portal can call them transparently without sending
-- extra parameters. Email becomes optional (default null).
--
-- Safe to run: replaces existing functions in place.
-- ═══════════════════════════════════════════════════════════════

-- Drop old signatures first so we can recreate cleanly
drop function if exists fn_a_add_client(text,text,int,text);
drop function if exists fn_a_add_recruiter(text,text,text);
drop function if exists fn_a_add_manager(text,text,text);

-- ── fn_a_add_client — email optional ──
create or replace function fn_a_add_client(p_name text, p_code text, p_target int default 25, p_email text default null)
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

-- ── fn_a_add_recruiter — email optional ──
create or replace function fn_a_add_recruiter(p_name text, p_code text, p_email text default null)
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

-- ── fn_a_add_manager — email optional ──
create or replace function fn_a_add_manager(p_name text, p_code text, p_email text default null)
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

-- Re-grant execute
grant execute on function
  fn_a_add_client(text,text,int,text),
  fn_a_add_recruiter(text,text,text),
  fn_a_add_manager(text,text,text)
to authenticated;
