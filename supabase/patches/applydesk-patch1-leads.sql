-- ═══════════════════════════════════════════
-- APPLYDESK PATCH 1: LEADS
-- Paste into Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════

create table if not exists app_leads (
  id bigint generated always as identity primary key,
  first_name text not null,
  last_name text default '',
  email text not null,
  phone text default '',
  plan text default '',
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);

alter table app_leads enable row level security;
-- No policies: direct access denied; RPC only.

-- Public lead submission (called by the landing page form)
create or replace function fn_submit_lead(p_first text, p_last text, p_email text, p_phone text, p_plan text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_first,''))) = 0 or length(trim(coalesce(p_email,''))) = 0 then
    return json_build_object('ok', false, 'err', 'missing fields');
  end if;
  if length(p_first) > 100 or length(coalesce(p_last,'')) > 100 or length(p_email) > 200
     or length(coalesce(p_phone,'')) > 50 or length(coalesce(p_plan,'')) > 100 then
    return json_build_object('ok', false, 'err', 'too long');
  end if;
  insert into app_leads(first_name, last_name, email, phone, plan)
  values (trim(p_first), trim(coalesce(p_last,'')), trim(p_email), trim(coalesce(p_phone,'')), trim(coalesce(p_plan,'')));
  return json_build_object('ok', true);
end $$;

-- Team access: admin + managers see leads; recruiters and clients do not.
create or replace function fn_get_leads(p_actor text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  return json_build_object('ok', true, 'leads',
    (select coalesce(json_agg(row_to_json(l) order by l.created_at desc), '[]'::json) from app_leads l));
end $$;

create or replace function fn_set_lead_status(p_actor text, p_id bigint, p_status text)
returns json language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from fn_role(p_actor);
  if v_role not in ('admin','manager') then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  if p_status not in ('new','contacted','closed') then return json_build_object('ok', false, 'err', 'bad status'); end if;
  update app_leads set status = p_status where id = p_id;
  return json_build_object('ok', true);
end $$;

create or replace function fn_del_lead(p_actor text, p_id bigint)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then return json_build_object('ok', false, 'err', 'not allowed'); end if;
  delete from app_leads where id = p_id;
  return json_build_object('ok', true);
end $$;

grant execute on function
  fn_submit_lead(text,text,text,text,text),
  fn_get_leads(text),
  fn_set_lead_status(text,bigint,text),
  fn_del_lead(text,bigint)
to anon;
