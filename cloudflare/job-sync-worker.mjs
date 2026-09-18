import config from "../workers/companies.json" with { type: "json" };
import { runJobSync } from "../workers/lib/job-sync-runner.mjs";
import { validSyncToken } from "../workers/lib/sync-auth.mjs";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

function requireBinding(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing Cloudflare Worker secret or variable: ${name}`);
  }
  return value.trim();
}

function createSupabaseRest(env, fetchImpl = fetch) {
  const serviceKey = requireBinding(env, "SUPABASE_SERVICE_ROLE_KEY");
  const baseUrl = requireBinding(env, "SUPABASE_URL").replace(/\/$/, "");
  return async function rest(path, { method = "GET", body, prefer } = {}) {
    const response = await fetchImpl(baseUrl + "/rest/v1/" + path.replace(/^\//, ""), {
      method,
      signal: AbortSignal.timeout(20000),
      headers: {
        apikey: serviceKey,
        Authorization: "Bearer " + serviceKey,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      const detail = typeof json === "object" ? JSON.stringify(json).slice(0, 500) : text.slice(0, 500);
      throw new Error(`${method} ${path} failed ${response.status}: ${detail}`);
    }
    return json;
  };
}

export async function runWorkerJobSync({
  env,
  fetchImpl = fetch,
  dryRun = false,
  log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), worker: "cloudflare-job-sync", ...event })),
} = {}) {
  const rest = dryRun ? null : createSupabaseRest(env, fetchImpl);
  const result = await runJobSync({ config, rest, fetchImpl, dryRun, log });
  if (result.failures && !dryRun) {
    throw new Error(`Job sync completed with ${result.failures} failed employer feeds; see app_job_feed_status.`);
  }
  return result;
}

async function handleJobSyncRequest(request, env) {
  const url = new URL(request.url);
  const authorized = await validSyncToken(request.headers.get("Authorization"), env?.JOB_SYNC_SECRET);
  if (!authorized) return new Response("Unauthorized", { status: 401 });
  const dryRun = url.searchParams.get("dry-run") === "1";
  const result = await runWorkerJobSync({ env, dryRun });
  return new Response(JSON.stringify(result), {
    status: result.failures ? 502 : 200,
    headers: JSON_HEADERS,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/job-sync" && request.method === "POST") {
      return handleJobSyncRequest(request, env);
    }
    if (url.pathname === "/job-sync" && request.method === "GET") {
      return new Response("Use POST", { status: 405, headers: { Allow: "POST" } });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    const job = runWorkerJobSync({ env });
    if (ctx?.waitUntil) {
      ctx.waitUntil(job);
    } else {
      await job;
    }
  },
};
