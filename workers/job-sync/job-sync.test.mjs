import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, fetchBoard, isEligibleJob, isUSLocation, normalizeJob, sponsorshipEvidence } from '../lib/job-feeds.mjs';
import { runJobSync } from '../lib/job-sync-runner.mjs';

const now = '2026-09-18T12:00:00.000Z';
// Fictional fixtures model public ATS response shapes; these are never seed data.
const ghJob = (overrides = {}) => ({ id: 101, internal_job_id: 8001, title: 'Data Engineer', location: { name: 'Seattle, Washington' }, first_published: '2026-09-17T12:00:00Z', updated_at: '2026-09-18T01:00:00Z', absolute_url: 'https://boards.greenhouse.io/test/jobs/101', content: '&lt;p&gt;We sponsor visas (O-1, H-1B, green card). 2+ years of experience. Full-time position.&lt;/p&gt;', ...overrides });
const normalize = job => normalizeJob('greenhouse', 'test', 'Test Employer', job, now);
const response = (json, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

test('H1B requires positive employer evidence; denials and questions cannot qualify', () => {
  for (const text of [
    'Do you require H1B sponsorship?', 'H1B experience preferred.', 'We sponsor visas.',
    'We have a history of H1B sponsorship.', 'We sponsor H1B candidates. We cannot sponsor visas for this role.',
    'We sponsor H1B. Sponsorship is not available for this role.',
    'We sponsor H1B. Applicants must work without current or future sponsorship.',
    'We sponsor H1B. Applicants must not require visa sponsorship.',
    'We sponsor H1B. H1B visas are not supported for this role.',
    'We sponsor H1B at other locations. We do not offer any visa sponsorship for this position.',
  ]) assert.notEqual(sponsorshipEvidence(text).sponsorship_status, 'explicit_h1b', text);
  for (const text of ['We sponsor visas (O-1, H-1B, green card) from day one.', 'H-1B sponsorship is available.', 'We can provide visa sponsorship, including H1B.']) {
    assert.equal(sponsorshipEvidence(text).sponsorship_status, 'explicit_h1b', text);
  }
  const caveat = sponsorshipEvidence("We sponsor H1B, O1, and more. We can't guarantee sponsorship for every role.");
  assert.equal(caveat.sponsorship_status, 'explicit_h1b');
  assert.match(caveat.sponsorship_evidence, /can't guarantee/);
});

test('encoded ATS content is decoded, with the employer quote retained', () => {
  assert.equal(cleanText('&amp;lt;p&amp;gt;H&amp;#45;1B &amp;amp; visas&amp;lt;/p&amp;gt;'), 'H-1B & visas');
  const row = normalize(ghJob());
  assert.equal(row.sponsorship_status, 'explicit_h1b');
  assert.match(row.sponsorship_evidence, /We sponsor visas/);
  assert.equal(row.company, 'Test Employer');
  assert.equal(row.employment_type, 'Full-time');
  assert.equal(row.years_required, '2+ years of experience');
  assert.equal(row.salary_text, '');
});

test('transfer-only and existing-holder rules do not imply a new graduate can receive H1B sponsorship', () => {
  for (const text of [
    'We sponsor H1B transfers only.',
    'We sponsor H1B transfers, but not new petitions.',
    'We sponsor H1B transfer sponsorship only.',
    'We sponsor only existing H1B visas.',
    'We sponsor H1B visas. H1B transfer candidates only.',
    'We sponsor H1B visas. Only existing H1B holders are eligible.',
    'We sponsor H1B visas. Existing H1B visa holders only.',
    'We sponsor H1B visas. Candidates must currently hold an H1B visa.',
    'We sponsor H1B visas. No new H1B petitions are accepted.',
    'We sponsor H1B visas. We do not file new H1B petitions.',
    'We sponsor H1B visas. We cannot support initial petitions.',
    'We sponsor H1B transfers. No lottery sponsorship is offered.',
  ]) {
    const evidence = sponsorshipEvidence(text);
    assert.notEqual(evidence.sponsorship_status, 'explicit_h1b', text);
    assert.equal(isEligibleJob(normalize(ghJob({ content: text })), now), false, text);
  }
  assert.equal(sponsorshipEvidence('We sponsor H1B visas, including new petitions and transfers.').sponsorship_status, 'explicit_h1b');
});

test('US eligibility uses location evidence, not a description mentioning America', () => {
  for (const location of ['Seattle, Washington', 'San Francisco', 'Austin, TX', 'Remote - US', 'New York; London, UK']) assert.equal(isUSLocation(location), true, location);
  for (const location of ['Remote', 'North America', 'London, UK', 'Vancouver, Washington, Canada', 'Georgia']) assert.equal(isUSLocation(location), false, location);
  assert.equal(isUSLocation('San Francisco', [{ postalAddress: { addressCountry: 'GB' } }]), false);
  assert.equal(isUSLocation('Remote', [{ postalAddress: { addressCountry: 'USA' } }]), true);
  assert.equal(isEligibleJob(normalize(ghJob({ location: { name: 'London, UK' } })), now), false);
});

test('updated_at is never relabeled as publication, and unknown/old/future/closed-date jobs are excluded', () => {
  const row = normalize(ghJob({ first_published: '2025-01-01T00:00:00Z' }));
  assert.equal(row.posted_at, '2025-01-01T00:00:00.000Z');
  assert.equal(row.date_basis, 'first_published');
  assert.equal(isEligibleJob(row, now), false);
  const unknown = normalize(ghJob({ first_published: undefined }));
  assert.equal(unknown.posted_at, null);
  assert.equal(unknown.date_basis, 'unknown');
  assert.equal(isEligibleJob(unknown, now), false);
  assert.equal(isEligibleJob(normalize(ghJob({ first_published: '2026-10-01T00:00:00Z' })), now), false);
  assert.equal(isEligibleJob(normalize(ghJob({ application_deadline: '2026-09-18T11:00:00Z' })), now), false);
  assert.equal(isEligibleJob(normalize(ghJob({ internal_job_id: null })), now), false);
  assert.equal(isEligibleJob(normalize(ghJob({ absolute_url: 'javascript:alert(1)' })), now), false);
  assert.equal(isEligibleJob(normalize(ghJob()), now), true);
});

test('Ashby uses company configuration and explicitly labels LAST published date', () => {
  const row = normalizeJob('ashby', 'test', 'Test Company', {
    id: 'abc', title: 'Engineer', department: 'Engineering', location: 'Remote', address: { postalAddress: { addressCountry: 'US' } },
    descriptionPlain: 'We sponsor H1B visas.', publishedAt: '2026-09-17T00:00:00Z', employmentType: 'FullTime', workplaceType: 'Hybrid',
    jobUrl: 'https://jobs.ashbyhq.com/test/abc', compensation: { scrapeableCompensationSalarySummary: '$100,000 - $150,000' },
  }, now);
  assert.equal(row.company, 'Test Company');
  assert.equal(row.date_basis, 'last_published');
  assert.equal(row.work_mode, 'Hybrid');
  assert.equal(row.salary_text, '$100,000 - $150,000');
  assert.equal(isEligibleJob(row, now), true);
  assert.equal(isEligibleJob({ ...row, raw_json: { is_listed: false } }, now), false);
});

test('missing Greenhouse first publication is retrieved from the official detail endpoint', async () => {
  const calls = [];
  const rows = await fetchBoard({ source: 'greenhouse', board: 'test', company: 'Test' }, { now, fetchImpl: async url => {
    calls.push(url);
    return response(calls.length === 1 ? { jobs: [ghJob({ first_published: undefined })], meta: { total: 1 } } : ghJob());
  } });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/jobs\/101$/);
  assert.equal(rows[0].date_basis, 'first_published');
});

test('malformed/partial employer payloads fail rather than claiming every job is closed', async () => {
  for (const data of [{ error: 'unavailable' }, { jobs: [], meta: { total: 3 } }, { jobs: [ghJob(), ghJob()] }]) {
    await assert.rejects(fetchBoard({ source: 'greenhouse', board: 'test', company: 'Test' }, { now, fetchImpl: async () => response(data) }));
  }
});

test('successful refresh closes disappeared jobs, expires ineligible ones, and preserves first seen', async () => {
  const calls = [];
  const rest = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (!options.method) return [
      { id: 1, dedup_key: 'greenhouse:test:101', source_job_id: '101', first_seen_at: '2026-09-10T00:00:00Z', status: 'active' },
      { id: 2, dedup_key: 'greenhouse:test:102', source_job_id: '102', status: 'active' },
      { id: 3, dedup_key: 'greenhouse:test:103', source_job_id: '103', status: 'active' },
    ];
  };
  const result = await runJobSync({ config: { greenhouse: ['test'] }, rest, now, log: () => {}, fetchImpl: async () => response({ jobs: [ghJob(), ghJob({ id: 103, content: 'We cannot sponsor visas.' })] }) });
  assert.equal(result.upserted, 1);
  assert.equal(result.closed, 1);
  assert.ok(calls.some(call => call.path === 'app_job_pool?id=in.(2)' && call.body.status === 'closed'));
  const updatedRows = calls.filter(call => call.path === 'app_job_pool?on_conflict=dedup_key').flatMap(call => call.body);
  const excluded = updatedRows.find(row => row.source_job_id === '103');
  assert.equal(excluded.status, 'stale');
  assert.equal(excluded.sponsorship_status, 'not_sponsored');
  assert.equal(excluded.sponsorship_evidence, 'We cannot sponsor visas.');
  assert.equal(updatedRows.find(row => row.source_job_id === '101').first_seen_at, '2026-09-10T00:00:00Z');
  assert.ok(calls.some(call => call.path.startsWith('app_job_feed_status?source=') && call.body.status === 'ok' && call.body.last_success_at === now));
});

test('feed outage never closes jobs or erases last_success_at, while other boards continue', async () => {
  const calls = [];
  const result = await runJobSync({ config: { greenhouse: ['broken', 'test'] }, now, log: () => {}, rest: async (path, options = {}) => { calls.push({ path, ...options }); return []; }, fetchImpl: async url => url.includes('/broken/') ? response({}, 503) : response({ jobs: [ghJob()] }) });
  assert.equal(result.failures, 1);
  assert.equal(result.upserted, 1);
  assert.equal(calls.some(call => call.body?.status === 'closed'), false);
  const failed = calls.find(call => call.body?.status === 'failed');
  assert.ok(failed);
  assert.equal(Object.hasOwn(failed.body, 'last_success_at'), false);
  assert.ok(calls.some(call => call.body?.status === 'stale' && call.path.includes('last_verified_at.lt.')));
});

test('dry run reads public feeds and never calls persistence', async () => {
  const result = await runJobSync({ config: { greenhouse: ['test'] }, dryRun: true, now, log: () => {}, rest: () => assert.fail('No database access permitted'), fetchImpl: async () => response({ jobs: [ghJob()] }) });
  assert.equal(result.eligible, 1);
  assert.equal(result.upserted, 0);
});
