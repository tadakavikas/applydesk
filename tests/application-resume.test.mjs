import test from 'node:test';
import assert from 'node:assert/strict';
import { loadResumeLibrary } from './resume-test-helpers.mjs';
const model = loadResumeLibrary('model');

function harness() {
  let memberId = 'member-a';
  const accounts = {
    'member-a': { application_resume_source: 'applydesk', resumes: [{ id: 1, file_name: 'a.docx', storage_path: 'a/original.docx', parsed_profile: { name: 'Original A', skills: 'Python' }, is_primary: true }], applications: [] },
    'member-b': { resumes: [{ id: 2, file_name: 'b.pdf', parsed_profile: { name: 'Member B' }, is_primary: true }], applications: [] },
  };
  const calls = [], exports = [], links = [], signed = [];
  const library = loadResumeLibrary('api', {
    require(name) {
      if (name === './model') return model;
      if (name === './resume-files') return {
        resumeLatex: () => 'latex',
        exportResume: async (...args) => exports.push(args),
      };
      if (name === './client') return {
        getMember: async () => ({ kind: 'member', profile: { status: 'active' }, session: { user: { id: memberId } } }),
        validEmployerUrl: (value) => value || '',
        rpc: async (fn, args) => {
          calls.push({ fn, args });
          if (fn === 'fn_ss_get_my_workspace') return structuredClone(accounts[memberId]);
          if (fn === 'fn_ss_set_resume_preference') { accounts[memberId].application_resume_source = args.p_source; return { ok: true }; }
          if (fn === 'fn_ss_log_application') return { ok: true, id: 77, url: 'https://jobs.example.test/77' };
          throw new Error('Unexpected RPC ' + fn);
        },
        sb: { storage: { from: (bucket) => ({ createSignedUrl: async (...args) => {
          signed.push({ bucket, args }); return { data: { signedUrl: 'https://storage.example.test/saved-original' } };
        } }) } },
      };
      throw new Error('Unexpected dependency ' + name);
    },
    document: { createElement: () => ({ click() { links.push({ href: this.href, download: this.download }); } }) },
  });
  return { library, accounts, calls, exports, links, signed, switchMember(id) { memberId = id; library.resetAccountCache(); } };
}
const post = (body) => ({ method: 'POST', body: JSON.stringify(body) });
test('ApplyDesk resume defaults on old and new accounts; explicit custom preference persists only for that member', async () => {
  const h = harness();
  assert.equal((await h.library.api('account')).applicationResumeSource, 'applydesk');
  await h.library.api('preferences', { method: 'PATCH', body: JSON.stringify({ resumeSource: 'custom' }) });
  h.library.resetAccountCache();
  assert.equal((await h.library.api('account')).applicationResumeSource, 'custom');
  h.switchMember('member-b');
  assert.equal((await h.library.api('account')).applicationResumeSource, 'applydesk');
  h.switchMember('member-a');
  assert.equal((await h.library.api('account')).applicationResumeSource, 'custom');
});
test('application creation sends persisted source while preserving prepared ApplyDesk profile', async () => {
  const h = harness();
  await h.library.api('account');
  await h.library.api('activity', post({ action: 'application', jobId: '77', resumeId: '1', resumeSnapshot: { ...model.emptyProfile(), name: 'Frozen', skills: 'Python, SQL' } }));
  let call = h.calls.findLast((c) => c.fn === 'fn_ss_log_application');
  assert.equal(call.args.p_resume_source, 'applydesk');
  assert.equal(call.args.p_parsed_profile.skills, 'Python, SQL');
  await h.library.api('preferences', { method: 'PATCH', body: JSON.stringify({ resumeSource: 'custom' }) });
  await h.library.api('account');
  await h.library.api('activity', post({ action: 'application', jobId: '78', resumeId: '1' }));
  call = h.calls.findLast((c) => c.fn === 'fn_ss_log_application');
  assert.equal(call.args.p_resume_source, 'custom');
});
test('custom application download uses frozen original path/name after library replacement and preference changes', async () => {
  const h = harness();
  h.accounts['member-a'].applications = [{ id: 90, resume_snapshot: { source: 'custom', storage_path: 'a/archived/original.docx', file_name: 'original.docx', parsed_profile: { name: 'Do not export' } } }];
  h.accounts['member-a'].resumes = [];
  await h.library.downloadApplicationResume('90');
  assert.equal(h.exports.length, 0);
  assert.deepEqual(h.signed, [{ bucket: 'selfserve-resumes', args: ['a/archived/original.docx', 120, { download: 'original.docx' }] }]);
  assert.equal(h.links[0].download, 'original.docx');
  h.switchMember('member-b');
  await assert.rejects(h.library.downloadApplicationResume('90'), /could not be found/);
});
test('ApplyDesk and legacy snapshots export frozen profile even when new preference is custom', async () => {
  const h = harness();
  h.accounts['member-a'].application_resume_source = 'custom';
  h.accounts['member-a'].applications = [
    { id: 91, resume_snapshot: { source: 'applydesk', parsed_profile: { name: 'Frozen formatted', skills: 'Python' } } },
    { id: 92, resume_snapshot: { parsed_profile: { name: 'Legacy frozen' } } },
  ];
  await h.library.downloadApplicationResume('91');
  await h.library.downloadApplicationResume('92');
  assert.equal(h.exports[0][0].name, 'Frozen formatted');
  assert.equal(h.exports[0][0].skills, 'Python');
  assert.equal(h.exports[1][0].name, 'Legacy frozen');
  assert.equal(h.exports[0][1], 'pdf');
  assert.equal(h.signed.length, 0);
});
test('feed state distinguishes unsynced, failed, healthy empty, and ready before user filters', () => {
  assert.equal(model.feedAvailability(null), 'loading');
  assert.equal(model.feedAvailability({ jobs: [], sources: [] }), 'awaiting_sources');
  assert.equal(model.feedAvailability({ jobs: [], sources: [{ ok: false }] }), 'unavailable');
  assert.equal(model.feedAvailability({ jobs: [], sources: [{ ok: true }] }), 'no_eligible_jobs');
  assert.equal(model.feedAvailability({ jobs: [{}], sources: [{ ok: true }] }), 'ready');
  assert.equal(model.feedAvailability({ jobs: [{}], sources: [{ ok: false }] }), 'ready', 'latest sync failure does not hide still-current verified jobs');
});

test('a download started before sign-out cannot use a previous account result', async () => {
  const h = harness();
  h.accounts['member-a'].applications = [{ id: 93, resume_snapshot: { source: 'applydesk', parsed_profile: { name: 'Private previous account' } } }];
  const pending = h.library.downloadApplicationResume('93');
  h.switchMember('member-b');
  await assert.rejects(pending, /account changed/);
  assert.equal(h.exports.length, 0);
  assert.equal(h.signed.length, 0);
});
