import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJobSync } from '../lib/job-sync-runner.mjs';
import config from '../companies.json' with { type: 'json' };

// --dry-run reads public employer feeds only; it neither loads .env nor connects to Supabase.
export async function syncJobs({ dryRun = false } = {}) {
  const rest = dryRun ? null : (await import('../lib/supabase.mjs')).rest;
  return runJobSync({ config, rest, dryRun });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  syncJobs({ dryRun: process.argv.includes('--dry-run') }).then((result) => {
    if (result.failures) process.exitCode = 1;
  }).catch((err) => {
    console.error('[job-sync] fatal', err.message);
    process.exitCode = 1;
  });
}
