// ═══════════════════════════════════════════════════════════════
// APPLYDESK: invite-user Edge Function
//
// Runs on Supabase's servers. Uses the service_role key stored as a
// secret (never exposed to the browser). Only admins and managers can
// invoke it — checked by verifying the caller's JWT and looking up
// their role in app_auth_map.
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    // ── STEP 1: Verify the caller's JWT and get their role ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ ok: false, err: 'Missing authorization header' }, 401);
    }

    // Client with caller's JWT — used to check who they are
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: whoami, error: whoamiErr } = await callerClient.rpc('fn_whoami');
    if (whoamiErr || !whoami?.ok) {
      return json({ ok: false, err: 'Not authenticated' }, 401);
    }
    if (whoami.role !== 'admin' && whoami.role !== 'manager') {
      return json({ ok: false, err: 'Only admin or manager can invite' }, 403);
    }

    // ── STEP 2: Parse and validate the invitation request ──
    const body = await req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();
    const roleReq = (body.role || '').trim();
    const roleCode = (body.role_code || '').trim();

    if (!email || !roleReq || !roleCode) {
      return json({ ok: false, err: 'email, role, role_code required' }, 400);
    }
    if (!['manager', 'recruiter', 'client'].includes(roleReq)) {
      return json({ ok: false, err: 'invalid role' }, 400);
    }
    // Only admin can invite managers
    if (roleReq === 'manager' && whoami.role !== 'admin') {
      return json({ ok: false, err: 'Only admin can invite managers' }, 403);
    }

    // ── STEP 3: Confirm the role row exists and email matches ──
    // Uses service key to bypass RLS (safe: we already authorized the caller)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const table = 'app_' + (roleReq === 'manager' ? 'managers' : roleReq === 'recruiter' ? 'recruiters' : 'clients');

    const { data: row } = await admin.from(table).select('code, email').eq('code', roleCode).maybeSingle();
    if (!row) {
      return json({ ok: false, err: `No ${roleReq} row with code ${roleCode}` }, 404);
    }

    // Backfill email if missing, or reject if it doesn't match
    if (!row.email) {
      await admin.from(table).update({ email }).eq('code', roleCode);
    } else if (row.email.trim().toLowerCase() !== email) {
      return json({ ok: false, err: `Role has different email on file (${row.email}). Update it first.` }, 409);
    }

    // ── STEP 4: Send the invitation ──
    // Supabase generates the auth.users row + emails a magic link.
    // Our patch6 trigger auto-links to the role via email match.
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://getapplydesk.com/portal.html',
      data: { role: roleReq, role_code: roleCode, invited_by: whoami.name || whoami.role },
    });

    if (inviteErr) {
      // If already invited, that's fine — treat as success
      if (String(inviteErr.message || '').toLowerCase().includes('already')) {
        return json({ ok: true, note: 'User already has an account. No new email sent.' });
      }
      return json({ ok: false, err: inviteErr.message || 'Invite failed' }, 500);
    }

    return json({ ok: true, user_id: invited?.user?.id, email });
  } catch (e) {
    return json({ ok: false, err: String(e?.message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
