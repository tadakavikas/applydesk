-- ═══════════════════════════════════════════════════════
-- APPLYDESK PATCH 3: PERMISSIONS + CLAIM SYSTEM + EDIT WINDOW
-- Paste into Supabase SQL Editor and Run.
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════

-- ---------- SCHEMA CHANGES ----------
alter table app_leads add column if not exists claimed_by text;
alter table app_leads add column if not exists claimed_at timestamptz;
alter table app_leads add column if not exists source text default 'website';

alter table app_messages add column if not exists edited_at timestamptz;

-- ---------- MANAGERS CAN CREATE CLIENTS + RECRUITERS ----------
create or replace function fn_add_client(p_actor text, p_name text, p_code text, p_target int)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from fn_role(p_code)) then return json_build_object('ok', false, 'err', 'code in use'); end if;
  insert into app_clients(code, name, target) values (p_code, p_name, greatest(1, coalesce(p_target, 25)));
  return json_build_object('ok', true);
end $$;

create or replace function fn_add_recruiter(p_actor text, p_name text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if exists (select 1 from fn_role(p_code)) then return json_build_object('ok', false, 'err', 'code in use'); end if;
  insert into app_recruiters(code, name) values (p_code, p_name);
  return json_build_object('ok', true);
end $$;

-- Managers can also assign clients to recruiters
create or replace function fn_toggle_assign(p_actor text, p_recruiter text, p_client text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_assigned text[];
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  select assigned into v_assigned from app_recruiters where code = p_recruiter;
  if v_assigned is null then return json_build_object('ok', false, 'err', 'no recruiter'); end if;
  if p_client = any(v_assigned) then
    update app_recruiters set assigned = array_remove(assigned, p_client) where code = p_recruiter;
  else
    update app_recruiters set assigned = array_append(assigned, p_client) where code = p_recruiter;
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------- LEADS: CLAIM SYSTEM ----------
create or replace function fn_get_leads(p_actor text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  return json_build_object('ok', true, 'leads',
    (select coalesce(json_agg(json_build_object(
      'id', l.id, 'first_name', l.first_name, 'last_name', l.last_name,
      'email', l.email, 'phone', l.phone, 'plan', l.plan, 'status', l.status,
      'source', l.source, 'created_at', l.created_at,
      'claimed_by', l.claimed_by, 'claimed_at', l.claimed_at,
      'claimed_by_name', case when l.claimed_by is null then null else fn_team_name(l.claimed_by) end
    ) order by l.created_at desc), '[]'::json) from app_leads l));
end $$;

create or replace function fn_claim_lead(p_actor text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_current text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'only managers can claim'); end if;
  select claimed_by into v_current from app_leads where id = p_id;
  if v_current is not null and v_role <> 'admin' then
    return json_build_object('ok', false, 'err', 'already claimed');
  end if;
  update app_leads set claimed_by = p_actor, claimed_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_reassign_lead(p_actor text, p_id bigint, p_new_owner text)
returns json language plpgsql security definer set search_path = public as $$
declare v_new_role text;
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  if p_new_owner is null or p_new_owner = '' then
    update app_leads set claimed_by = null, claimed_at = null where id = p_id;
  else
    select role into v_new_role from fn_role(p_new_owner);
    if v_new_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'invalid owner'); end if;
    update app_leads set claimed_by = p_new_owner, claimed_at = now() where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function fn_set_lead_status(p_actor text, p_id bigint, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_owner text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if p_status not in ('new','contacted','closed') then return json_build_object('ok', false, 'err', 'bad status'); end if;
  select claimed_by into v_owner from app_leads where id = p_id;
  -- Only owner or admin can change status
  if v_role <> 'admin' and (v_owner is null or v_owner <> p_actor) then
    return json_build_object('ok', false, 'err', 'claim it first');
  end if;
  update app_leads set status = p_status where id = p_id;
  return json_build_object('ok', true);
end $$;

-- Manager creates a lead manually (auto-claims to themselves)
create or replace function fn_create_lead(p_actor text, p_first text, p_last text, p_email text, p_phone text, p_plan text, p_source text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text; v_id bigint;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if length(trim(coalesce(p_first,''))) = 0 or length(trim(coalesce(p_email,''))) = 0
     or length(trim(coalesce(p_phone,''))) = 0 or length(trim(coalesce(p_plan,''))) = 0 then
    return json_build_object('ok', false, 'err', 'first name, email, phone, and plan are required');
  end if;
  insert into app_leads(first_name, last_name, email, phone, plan, source, claimed_by, claimed_at)
    values (trim(p_first), trim(coalesce(p_last,'')), trim(p_email), trim(p_phone),
            trim(p_plan), coalesce(nullif(trim(p_source),''),'manual'), p_actor, now())
    returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;

-- ---------- MESSAGES: EDIT WINDOW + ADMIN DELETE ----------
create or replace function fn_edit_message(p_actor text, p_id bigint, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_by text; v_ts timestamptz;
begin
  if length(trim(coalesce(p_body,''))) = 0 then return json_build_object('ok', false, 'err', 'empty'); end if;
  select by_code, ts into v_by, v_ts from app_messages where id = p_id;
  if v_by is null then return json_build_object('ok', false, 'err', 'not found'); end if;
  if v_by <> p_actor then return json_build_object('ok', false, 'err', 'not your message'); end if;
  if v_ts < now() - interval '5 minutes' then return json_build_object('ok', false, 'err', '5 minute edit window expired'); end if;
  update app_messages set body = trim(p_body), edited_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_del_message(p_actor text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'admin only'); end if;
  delete from app_messages where id = p_id;
  return json_build_object('ok', true);
end $$;

-- Return edited flag in state
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
      'recruiters', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from app_recruiters r),
      'managers',   case when v_role = 'admin'
                      then (select coalesce(json_agg(row_to_json(m)), '[]'::json) from app_managers m)
                      else (select coalesce(json_agg(json_build_object('code', m.code, 'name', m.name)), '[]'::json) from app_managers m) end,
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
  elsif v_role = 'recruiter' then
    select assigned into v_assigned from app_recruiters where code = p_code;
    result := json_build_object(
      'ok', true, 'role', v_role, 'name', v_name,
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
      'ok', true, 'role', v_role, 'name', v_name,
      'me',       (select row_to_json(c) from app_clients c where c.code = p_code),
      'records',  (select coalesce(json_agg(row_to_json(x) order by x.date desc, x.id desc), '[]'::json) from app_records x where x.client_code = p_code),
      'messages', (select coalesce(json_agg(json_build_object(
                      'id', g.id, 'from_role', g.from_role, 'by_code', g.by_code,
                      'by_name', case when g.from_role = 'client'
                                   then coalesce((select name from app_clients where code = g.by_code), 'You')
                                   else fn_team_name(g.by_code) end,
                      'body', g.body, 'ts', g.ts, 'edited_at', g.edited_at) order by g.ts), '[]'::json)
                   from app_messages g where g.client_code = p_code)
    );
  end if;
  return result;
end $$;

-- ---------- PERMISSIONS ----------
grant execute on function
  fn_claim_lead(text,bigint),
  fn_reassign_lead(text,bigint,text),
  fn_create_lead(text,text,text,text,text,text,text),
  fn_edit_message(text,bigint,text),
  fn_del_message(text,bigint)
to anon;
