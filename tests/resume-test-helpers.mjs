import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Run the actual TypeScript functions offline, resolving their optional format
// libraries locally and supplying only the browser download boundary as a stub.
export function loadResumeLibrary(file, overrides = {}) {
  const source = fs.readFileSync(new URL('../desk-src/lib/' + file + '.ts', import.meta.url), 'utf8');
  const {outputText} = ts.transpileModule(source, {
    compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}
  });
  const exports = {};
  const localRequire = name => name === '../../shared/job-search.mjs' ? require('../shared/job-search.mjs') : name === './model' ? loadResumeLibrary('model')
    : name === 'mammoth' ? require('mammoth/mammoth.browser.js') : require(name);
  const env = {
    require:localRequire, exports, module:{exports}, Blob, Uint8Array,
    document:undefined, URL, setTimeout,
    ...overrides
  };
  new Function(...Object.keys(env), outputText)(...Object.values(env));
  return exports;
}

export const candidateText = `Jordan Candidate
Chicago, IL
candidate@example.test | (202) 555-0147 | linkedin.com/in/example-candidate

Professional Summary
Data engineer building reliable cloud systems with Python and SQL.

Professional Experience
Data Engineer | Example Analytics | Jan 2023 - Present
- Maintained PostgreSQL reporting for 20 teams.
- Coordinated release documentation.

Software Engineer | Sample Systems | Jun 2020 - Dec 2022
- Built Python data pipelines on AWS for 100 projects.
- Automated validation with SQL.

Technical Skills
Python, SQL, PostgreSQL, Amazon Web Services, Git

Education
B.S. Computer Science | Example University | 2020

Certifications
Cloud fundamentals certificate

Selected Projects
Open data quality checker using Python.

Achievements
Reduced validation time by 25%.
`;

export function exampleJob(overrides = {}) {
  return {
    id:'test-job', board:'Example board', company:'Example Employer', title:'Data Engineer',
    location:'Chicago, IL', states:['Illinois'], workMode:'Hybrid', employment:'Full-time',
    salary:null, experience:'3 years', description:'Python, SQL and AWS data pipelines.',
    skills:['Python','SQL','AWS'], url:'https://jobs.lever.co/example/test-job',
    publishedAt:'2026-09-18T10:00:00Z', dateLabel:'Published', checkedAt:'2026-09-18T11:00:00Z',
    sponsorship:'h1b', evidence:'Example test fixture only', ...overrides
  };
}

export function downloadHarness() {
  const downloads = [];
  const blobs = new Map();
  const revoked = [];
  const library = loadResumeLibrary('resume-files', {
    document:{createElement(tag) {
      if (tag !== 'a') throw new Error('Unexpected DOM operation: ' + tag);
      return {href:'',download:'',click() { downloads.push({name:this.download,blob:blobs.get(this.href)}); }};
    }},
    URL:{
      createObjectURL(blob) { const key = 'blob:test-' + blobs.size; blobs.set(key,blob); return key; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    setTimeout(callback) { callback(); return 0; }
  });
  return {library,downloads,revoked};
}
