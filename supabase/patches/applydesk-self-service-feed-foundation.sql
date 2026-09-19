-- Public job-feed foundation for ApplyDesk self-service.
-- Requires a preflight confirming both feed tables are absent.
-- Run this before the unchanged applydesk-patch10-self-service.sql.
-- Derived from patch 8's app_job_pool and patch 9's feed additions only.
-- Creates no managed-client Copilot tables, functions, memberships or storage.
-- Intentionally aborts if either table already exists; inspect first rather
-- than silently changing the permissions or schema of an unexpected table.
begin;

create table public.app_job_pool (
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
  created_at timestamptz not null default now(),
  source_board text,
  source_job_id text,
  date_basis text not null default 'unknown',
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_verified_at timestamptz,
  closed_at timestamptz,
  status text not null default 'stale',
  country_code text,
  sponsorship_status text not null default 'unknown',
  sponsorship_evidence text,
  sponsorship_evidence_url text,
  constraint app_job_pool_date_basis_check
    check (date_basis in ('first_published','last_published','provider_created','unknown')),
  constraint app_job_pool_status_check
    check (status in ('active','closed','stale')),
  constraint app_job_pool_sponsorship_check
    check (sponsorship_status in ('explicit_h1b','visa_sponsorship','not_sponsored','unknown'))
);

create index app_job_pool_posted_idx on public.app_job_pool(posted_at desc);

create table public.app_job_feed_status (
  source text not null,
  source_board text not null,
  company text not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending','syncing','ok','failed')),
  error_message text,
  jobs_seen int not null default 0,
  jobs_eligible int not null default 0,
  primary key (source,source_board)
);

-- The server Worker maintains the feed. Browser sessions read eligible jobs
-- through the authenticated, ownership-checked patch 10 RPCs only.
alter table public.app_job_pool enable row level security;
alter table public.app_job_feed_status enable row level security;
revoke all on public.app_job_pool,public.app_job_feed_status
  from public,anon,authenticated;
revoke all on sequence public.app_job_pool_id_seq from public,anon,authenticated;
grant all on public.app_job_pool,public.app_job_feed_status to service_role;
grant usage,select on sequence public.app_job_pool_id_seq to service_role;

notify pgrst, 'reload schema';
commit;

