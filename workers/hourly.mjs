import { syncJobs } from './job-sync/index.mjs';
import { matchJobs } from './match/index.mjs';
import './lib/env.mjs';

const interval = Number(process.env.JOB_SYNC_INTERVAL_MS || 3600000);

async function runOnce() {
  console.log(new Date().toISOString(), '[hourly] start');
  const sync = await syncJobs();
  const match = await matchJobs();
  console.log(new Date().toISOString(), '[hourly] done', { sync, match });
}

async function main() {
  await runOnce();
  if (process.argv.includes('--loop')) {
    console.log(`[hourly] looping every ${interval}ms`);
    setInterval(() => {
      runOnce().catch((err) => console.error('[hourly] FAIL', err));
    }, interval);
  }
}

main().catch((err) => {
  console.error('[hourly] fatal', err);
  process.exit(1);
});
