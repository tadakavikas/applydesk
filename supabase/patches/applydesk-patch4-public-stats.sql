-- ═══════════════════════════════════════════
-- APPLYDESK PATCH 4: PUBLIC STATS FOR LIVE COUNTER
-- Safe to run alongside existing schema.
-- ═══════════════════════════════════════════

-- Aggregate counters ONLY. Never exposes any client/record/lead details.
create or replace function fn_get_public_stats()
returns json language plpgsql security definer set search_path = public as $$
declare
  v_apps int;
  v_reach int;
  v_clients int;
begin
  select count(*) into v_apps
    from app_records
    where type = 'application'
      and date >= date_trunc('month', current_date);

  select count(*) into v_reach
    from app_records
    where type = 'reachout'
      and date >= date_trunc('month', current_date);

  select count(*) into v_clients from app_clients;

  return json_build_object(
    'ok', true,
    'apps_this_month', coalesce(v_apps, 0),
    'reach_this_month', coalesce(v_reach, 0),
    'active_clients', coalesce(v_clients, 0)
  );
end $$;

grant execute on function fn_get_public_stats() to anon;
