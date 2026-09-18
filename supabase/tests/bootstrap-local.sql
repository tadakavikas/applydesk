-- ONLY for a fresh disposable local PostgreSQL database, never production.
-- Minimal Supabase platform and legacy membership objects for patch 9 tests.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant all on storage.objects to authenticated,service_role;
create table public.app_clients(code text primary key,name text not null);
create table public.app_recruiters(code text primary key,assigned text[] not null default '{}');
create table public.app_auth_map(user_id uuid primary key references auth.users(id),role text,role_code text);
alter table public.app_clients enable row level security;
alter table public.app_recruiters enable row level security;
alter table public.app_auth_map enable row level security;
create function public.fn_me() returns table(user_id uuid,role text,role_code text,display_name text)
language sql security definer set search_path=public,pg_temp as $$
 select m.user_id,m.role,m.role_code,m.role_code from app_auth_map m where m.user_id=auth.uid()
$$;
\ir ../patches/applydesk-patch8-auto-apply.sql
\ir ../patches/applydesk-patch9-member-workspace.sql
\ir ../patches/applydesk-patch10-self-service.sql
