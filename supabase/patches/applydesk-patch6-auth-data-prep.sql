-- ═══════════════════════════════════════════════════════════════
-- APPLYDESK PATCH 6: AUTH DATA PREP - STEP 2 OF AUTH MIGRATION
--
-- What this does:
--   1. Fills in email addresses for existing team + clients
--   2. Adds an auto-linking trigger: when you create a user in the
--      Supabase dashboard, we automatically link that new auth.users
--      row to their existing role row in app_auth_map.
--   3. Adds a verification view so you can see who's linked at a glance.
--
-- Safe to run: only updates existing rows, no deletions.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════


-- ───────────── PART A: POPULATE EMAILS ─────────────
-- Every role row now gets the email we'll use to invite that person.
-- The email is how Supabase Auth identifies each user during signup,
-- and it's what our trigger will use to auto-link them to their role.

update app_admin      set email = 'vikasthadaka43@gmail.com'          where code = 'vtproton@22';
update app_managers   set email = 'poojaande145@gmail.com'            where code = 'pooja00';
update app_recruiters set email = 'sahithigad@gmail.com'              where code = 'sahithi01';
update app_clients    set email = 'harithaadumala25@gmail.com'        where code = 'haritha2000';
update app_clients    set email = 'srivallihrushithaongole11389@gmail.com' where code = 'srivalli2001';
-- Anjuman gets added tomorrow morning when you have her email.


-- ───────────── PART B: AUTO-LINK TRIGGER ─────────────
-- This is the magic. When you go to Supabase → Authentication → Users
-- → Add user, and type in one of the emails above, Supabase inserts a
-- new row into auth.users. This trigger fires on that insert, looks
-- up the email in your role tables, and creates the app_auth_map row
-- automatically. No manual mapping required.

create or replace function fn_link_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_code text;
  v_email text := lower(trim(new.email));
begin
  -- Guard: skip if email is null
  if v_email is null or v_email = '' then
    return new;
  end if;

  -- Check each role table in priority order (admin > manager > recruiter > client)
  select 'admin', code into v_role, v_code from app_admin
    where lower(trim(email)) = v_email limit 1;

  if v_code is null then
    select 'manager', code into v_role, v_code from app_managers
      where lower(trim(email)) = v_email limit 1;
  end if;

  if v_code is null then
    select 'recruiter', code into v_role, v_code from app_recruiters
      where lower(trim(email)) = v_email limit 1;
  end if;

  if v_code is null then
    select 'client', code into v_role, v_code from app_clients
      where lower(trim(email)) = v_email limit 1;
  end if;

  -- If a role match was found, create the mapping
  if v_code is not null then
    insert into app_auth_map(user_id, role, role_code)
      values (new.id, v_role, v_code)
      on conflict (user_id) do update
        set role = excluded.role, role_code = excluded.role_code;
  end if;

  return new;
end $$;

-- Attach the trigger to auth.users. Fires on both INSERT (new signup)
-- and UPDATE (email confirmation, which sometimes lands as an update).
drop trigger if exists trg_link_auth_user on auth.users;
create trigger trg_link_auth_user
  after insert or update of email on auth.users
  for each row execute function fn_link_auth_user();


-- ───────────── PART C: VERIFICATION VIEW ─────────────
-- Simple query to check who's linked. Run this after you invite each
-- person to confirm they got mapped correctly.
-- Not a table — a saved query pattern. Run this ad-hoc.

-- Ready-to-use verification query (copy this into the SQL editor
-- separately, whenever you want to check state):
--
--   select
--     m.role,
--     m.role_code,
--     coalesce(
--       (select email from app_admin      where code = m.role_code and m.role = 'admin'),
--       (select email from app_managers   where code = m.role_code and m.role = 'manager'),
--       (select email from app_recruiters where code = m.role_code and m.role = 'recruiter'),
--       (select email from app_clients    where code = m.role_code and m.role = 'client')
--     ) as email,
--     u.email_confirmed_at as confirmed_at,
--     m.created_at as linked_at
--   from app_auth_map m
--   join auth.users u on u.id = m.user_id
--   order by m.created_at;
