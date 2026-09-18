import { requireEnv } from './env.mjs';

function headers(extra = {}) {
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function supabaseUrl() {
  return requireEnv('SUPABASE_URL').replace(/\/$/, '');
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const url = supabaseUrl() + '/rest/v1/' + path.replace(/^\//, '');
  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: headers(prefer ? { Prefer: prefer } : {}),
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = typeof json === 'object' ? JSON.stringify(json).slice(0, 500) : text.slice(0, 500);
    throw new Error(`${method} ${path} failed ${res.status}: ${detail}`);
  }
  return json;
}

export async function rpc(fn, args = {}) {
  return rest('rpc/' + fn, { method: 'POST', body: args });
}
