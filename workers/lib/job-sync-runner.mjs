import { configuredBoards, fetchBoard, FRESH_HOURS, isEligibleJob } from './job-feeds.mjs';

function defaultLog(event) { console.log(JSON.stringify({ at: new Date().toISOString(), worker: 'job-sync', ...event })); }
function boardFilter({ source, board }) { return `source=eq.${encodeURIComponent(source)}&source_board=eq.${encodeURIComponent(board)}`; }

async function existingRows(rest, board) {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rest(`app_job_pool?${boardFilter(board)}&select=id,dedup_key,source_job_id,first_seen_at,status&order=id.asc&limit=500&offset=${offset}`);
    if (!Array.isArray(page)) throw new Error('Could not load previous feed state');
    all.push(...page);
    if (page.length < 500) return all;
  }
}

async function patchIds(rest, ids, body) {
  for (let start = 0; start < ids.length; start += 200) {
    const group = ids.slice(start, start + 200).map(id => {
      if (!/^\d+$/.test(String(id))) throw new Error('Invalid persisted job ID');
      return id;
    });
    await rest(`app_job_pool?id=in.(${group.join(',')})`, { method: 'PATCH', body, prefer: 'return=minimal' });
  }
}

async function persistBoard(rest, board, rows, now) {
  const previous = await existingRows(rest, board);
  const previousByKey = new Map(previous.map(row => [row.dedup_key, row]));
  const eligible = rows.filter(row => isEligibleJob(row, now));
  const observedById = new Map(rows.map(row => [row.source_job_id, row]));
  const liveIds = new Set(rows.map(row => row.source_job_id));
  const eligibleIds = new Set(eligible.map(row => row.source_job_id));
  const removed = previous.filter(row => row.status !== 'closed' && !liveIds.has(row.source_job_id));
  const excluded = previous.filter(row => liveIds.has(row.source_job_id) && !eligibleIds.has(row.source_job_id));
  // Only a complete successful fetch can close jobs. An outage does not mean a job closed.
  await patchIds(rest, removed.map(row => row.id), { status: 'closed', closed_at: now });
  // Refresh all current source facts for an existing excluded job, including a
  // expired deadline or lost US eligibility. Sponsorship changes stay in the
  // active catalog when the job remains eligible; saved cards receive new labels.
  const updates = [...eligible, ...excluded.map(row => ({ ...observedById.get(row.source_job_id), status: 'stale' }))];
  for (let start = 0; start < updates.length; start += 100) {
    const body = updates.slice(start, start + 100).map(row => ({ ...row, first_seen_at: previousByKey.get(row.dedup_key)?.first_seen_at || now }));
    await rest('app_job_pool?on_conflict=dedup_key', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  return { upserted: eligible.length, closed: removed.length, excluded: excluded.length };
}

export async function runJobSync({ config, rest, fetchImpl = fetch, now = new Date().toISOString(), dryRun = false, log = defaultLog }) {
  if (!dryRun && typeof rest !== 'function') throw new Error('Supabase persistence is required unless dryRun=true');
  const boards = configuredBoards(config);
  if (!boards.length) throw new Error('No employer job boards configured');
  const result = { dryRun, upserted: 0, eligible: 0, closed: 0, failures: 0, feeds: [] };
  if (!dryRun) {
    // The API also enforces freshness at query time in case this worker is not running.
    const cutoff = new Date(Date.parse(now) - FRESH_HOURS * 3600000).toISOString();
    await rest(`app_job_pool?status=eq.active&or=(last_verified_at.is.null,last_verified_at.lt.${encodeURIComponent(cutoff)})`, { method: 'PATCH', body: { status: 'stale' }, prefer: 'return=minimal' });
  }
  for (const board of boards) {
    const feedPath = `app_job_feed_status?${boardFilter(board)}`;
    try {
      if (!dryRun) {
        // Ignore an existing row so a failed attempt cannot erase its last successful refresh.
        await rest('app_job_feed_status?on_conflict=source,source_board', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
          body: { source: board.source, source_board: board.board, company: board.company, status: 'syncing', last_attempt_at: now },
        });
        await rest(feedPath, { method: 'PATCH', body: { status: 'syncing', last_attempt_at: now, company: board.company, error_message: null }, prefer: 'return=minimal' });
      }
      const rows = await fetchBoard(board, { fetchImpl, now });
      const eligible = rows.filter(row => isEligibleJob(row, now)).length;
      const counts = dryRun ? { upserted: 0, closed: 0, excluded: 0 } : await persistBoard(rest, board, rows, now);
      if (!dryRun) await rest(feedPath, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'ok', last_success_at: now, jobs_seen: rows.length, jobs_eligible: eligible, error_message: null },
      });
      const feed = { source: board.source, board: board.board, status: 'ok', seen: rows.length, eligible, ...counts };
      result.upserted += counts.upserted;
      result.closed += counts.closed;
      result.eligible += eligible;
      result.feeds.push(feed);
      log(feed);
    } catch (err) {
      result.failures += 1;
      const message = String(err.message || 'Unknown feed error').slice(0, 500);
      if (!dryRun) {
        try { await rest(feedPath, { method: 'PATCH', body: { status: 'failed', error_message: message }, prefer: 'return=minimal' }); }
        catch (healthError) { log({ source: board.source, board: board.board, status: 'health_write_failed', error: String(healthError.message).slice(0, 300) }); }
      }
      const feed = { source: board.source, board: board.board, status: 'failed', error: message };
      result.feeds.push(feed);
      log(feed);
    }
  }
  log({ status: 'complete', dryRun, upserted: result.upserted, eligible: result.eligible, closed: result.closed, failures: result.failures });
  return result;
}
