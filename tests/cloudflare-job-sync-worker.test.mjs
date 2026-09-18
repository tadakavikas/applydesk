import test from "node:test";
import assert from "node:assert/strict";
import worker, { runWorkerJobSync } from "../cloudflare/job-sync-worker.mjs";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  JOB_SYNC_SECRET: "s".repeat(64),
};

const emptyFeed = async (url) => ({
  ok: true,
  status: 200,
  json: async () => String(url).includes("ashbyhq.com") ? { jobs: [] } : { jobs: [], meta: { total: 0 } },
});

test("Cloudflare job-sync HTTP endpoint requires the shared trigger secret", async () => {
  const request = new Request("https://jobs.example.com/job-sync", { method: "POST" });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 401);
});

test("Cloudflare job-sync can run as a dry run without Supabase secrets", async () => {
  const result = await runWorkerJobSync({
    env: { JOB_SYNC_SECRET: env.JOB_SYNC_SECRET },
    dryRun: true,
    fetchImpl: emptyFeed,
    log: () => {},
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.failures, 0);
});

test("Cloudflare job-sync scheduled path persists through Supabase REST", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith(env.SUPABASE_URL)) {
      calls.push({ href, options });
      return { ok: true, status: 200, text: async () => href.includes("select=") ? "[]" : "" };
    }
    return emptyFeed(url);
  };
  const result = await runWorkerJobSync({ env, fetchImpl, log: () => {} });
  assert.equal(result.failures, 0);
  assert.ok(calls.some((call) => call.href.includes("/rest/v1/app_job_feed_status")));
  assert.ok(calls.some((call) => call.options.headers.Authorization === "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY));
});
