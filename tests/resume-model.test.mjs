import test from 'node:test';
import assert from 'node:assert/strict';
import {loadResumeLibrary,candidateText,exampleJob} from './resume-test-helpers.mjs';

const model = loadResumeLibrary('model');

test('resume import maps a realistic candidate to the correct sections', () => {
  const p = model.parseProfile(candidateText);
  assert.equal(p.name,'Jordan Candidate');
  assert.equal(p.email,'candidate@example.test');
  assert.equal(p.phone,'(202) 555-0147');
  assert.equal(p.linkedin,'linkedin.com/in/example-candidate');
  assert.equal(p.summary.trim(),'Data engineer building reliable cloud systems with Python and SQL.');
  assert.match(p.experience,/Data Engineer \| Example Analytics/);
  assert.match(p.experience,/Software Engineer \| Sample Systems/);
  assert.equal(p.education.trim(),'B.S. Computer Science | Example University | 2020');
  assert.equal(p.certifications.trim(),'Cloud fundamentals certificate');
  assert.equal(p.projects.trim(),'Open data quality checker using Python.');
  assert.equal(p.achievements.trim(),'Reduced validation time by 25%.');
  assert.deepEqual(model.emptyProfile(),Object.fromEntries(Object.keys(p).map(key=>[key,''])));
});

test('resume location does not absorb the candidate name from a preceding line', () => {
  assert.equal(model.parseProfile(candidateText).location,'Chicago, IL');
});

test('skill extraction respects boundaries and recognizes supported aliases', () => {
  const found = model.extractSkills('JavaScript, TypeScript, C++, C#, NodeJS, Postgres, Amazon Web Services, Google Cloud, continuous integration and natural language processing.');
  for (const skill of ['JavaScript','TypeScript','C++','C#','Node.js','PostgreSQL','AWS','GCP','CI/CD','NLP']) assert(found.includes(skill),skill);
  for (const absent of ['Java','R','Go','SQL']) assert(!found.includes(absent),absent);
  assert.deepEqual(model.extractSkills('Ongoing programming in a lawful, sparkling neighborhood.'),[]);
});

test('skill coverage reports matched and missing skills without inventing an ATS score', () => {
  const p = {...model.emptyProfile(),skills:'Python, Amazon Web Services'};
  assert.deepEqual(model.matchProfile(p,exampleJob({skills:['Python','AWS','SQL','Terraform']})), {
    score:50,matched:['Python','AWS'],missing:['SQL','Terraform']
  });
  assert.equal(model.matchProfile(null,exampleJob()).score,null);
  assert.deepEqual(model.matchProfile(p,exampleJob({skills:[]})),{score:null,matched:[],missing:[]});
});

test('tailoring preserves candidate facts and adds only explicitly confirmed job skills', () => {
  const p = model.parseProfile(candidateText);
  const original = structuredClone(p);
  const job = exampleJob({skills:['Python','SQL','Terraform']});
  const tailored = model.tailorProfile(p,job,'light',['Terraform','Kubernetes']);
  for (const key of Object.keys(p).filter(key=>key!=='skills')) assert.equal(tailored[key],p[key],key);
  assert(model.extractSkills(tailored.skills).includes('Terraform'));
  assert(!model.extractSkills(tailored.skills).includes('Kubernetes'));
  assert(!model.extractSkills(model.tailorProfile(p,job,'substantial',[]).skills).includes('Terraform'));
  assert.deepEqual(p,original,'tailoring must not mutate the stored original resume');
});

test('substantial tailoring never moves a parsed resume bullet to a different employer', () => {
  const p = model.parseProfile(candidateText);
  const tailored = model.tailorProfile(p,exampleJob({skills:['Python','AWS']}),'substantial',[]);
  const [first,second] = tailored.experience.split('Software Engineer | Sample Systems');
  assert.match(first,/Maintained PostgreSQL reporting for 20 teams/);
  assert.match(first,/Coordinated release documentation/);
  assert.doesNotMatch(first,/Built Python data pipelines/);
  assert.match(second,/Built Python data pipelines on AWS for 100 projects/);
  assert.match(second,/Automated validation with SQL/);
});

test('tailoring also preserves employer ownership when PDF text has no blank role separators', () => {
  const p = model.parseProfile(candidateText.replace(/\n\n/g,'\n'));
  const tailored = model.tailorProfile(p,exampleJob({skills:['Python','AWS']}),'substantial',[]);
  const [first,second] = tailored.experience.split('Software Engineer | Sample Systems');
  assert.match(first,/Maintained PostgreSQL reporting for 20 teams/);
  assert.match(first,/Coordinated release documentation/);
  assert.doesNotMatch(first,/Built Python data pipelines/);
  assert.match(second,/Built Python data pipelines on AWS for 100 projects/);
  assert.match(second,/Automated validation with SQL/);
});
