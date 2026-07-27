-- ═══════════════════════════════════════════
-- APPLYDESK PATCH 2: FULL CLIENT CLEANUP ON DELETE
-- Paste into Supabase SQL Editor and Run.
-- ═══════════════════════════════════════════

create or replace function fn_del_client(p_actor text, p_code text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if (select role from fn_role(p_actor)) <> 'admin' then
    return json_build_object('ok', false, 'err', 'not allowed');
  end if;
  -- resumes are removed automatically via FK cascade when records go
  delete from app_records  where client_code = p_code;
  delete from app_messages where client_code = p_code;
  delete from app_clients  where code = p_code;
  update app_recruiters set assigned = array_remove(assigned, p_code);
  return json_build_object('ok', true);
end $$;
