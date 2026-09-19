import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadResumeLibrary} from './resume-test-helpers.mjs';
const {matchesJobQuery}=loadResumeLibrary('model');
const job=(title,overrides={})=>({title,company:'Example Systems',skills:['Python','React','TypeScript'],description:'',...overrides});

test('software developer, engineer and SWE aliases work in both directions without requiring adjacent words',()=>{
  for(const title of ['Software Engineer','Senior Software Developer','SWE II','Software Engineers']) {
    for(const query of ['software developer','Software ENGINEER','SWE','software, developer','softwaredeveloper'])
      assert(matchesJobQuery(job(title),query),`${title} / ${query}`);
  }
  assert(matchesJobQuery(job('Software Engineer'),'  '));
  assert(matchesJobQuery(job('Software Engineer'),'Example Python SOFTWARE developer'));
  assert(!matchesJobQuery(job('Software Engineer'),'software developer Stripe'));
  assert(!matchesJobQuery(job('Software Engineer'),'software developer Python Java'));
});

test('frontend, backend and fullstack aliases preserve specialty constraints and normalize punctuation',()=>{
  for(const [query,title] of [
    ['front-end developer','Frontend Engineer'],
    ['FRONT END engineer','Front-end Developer'],
    ['back.end developer','Backend Software Engineer'],
    ['back end engineer','Back-end Developer'],
    ['full–stack developer','Full Stack Engineer'],
    ['full_stack engineer','Full-stack Developer'],
    ['software developer Android','Platform Engineer, Android'],
    ['software engineer iOS','iOS Developer'],
  ]) assert(matchesJobQuery(job(title),query),`${title} / ${query}`);
  assert(!matchesJobQuery(job('Frontend Engineer'),'backend developer'));
  assert(!matchesJobQuery(job('Frontend Engineer',{company:'Backend Systems'}),'backend developer'));
  assert(!matchesJobQuery(job('Software Engineer'),'software developer frontend'));
  assert(matchesJobQuery(job('Backend Software Engineer'),'SWE backend'));
});

test('skill/company tokens retain exact boundaries and meaningful AND semantics',()=>{
  const target=job('Software Engineer',{company:'Café Systems',skills:['C++','C#','Node.js','JavaScript']});
  assert(matchesJobQuery(target,'software developer Cafe C++'));
  assert(matchesJobQuery(target,'C# nodejs systems'));
  assert(matchesJobQuery(target,'Node.js JavaScript'));
  assert(!matchesJobQuery(target,'Java'));
  assert(!matchesJobQuery(target,'C'));
  assert(!matchesJobQuery(target,'software developer Python'));
});

test('software specialties require relevant titles; ambiguous families also need software evidence',()=>{
  for(const title of ['Frontend Engineer','Backend Developer','Full-stack Engineer','Platform Engineer, Android','iOS Engineer','Lead SDET'])
    assert(matchesJobQuery(job(title,{skills:[]}),'software developer'),title);
  for(const title of ['Product Engineer','Platform Engineer','Forward Deployed Engineer','Staff Engineer, Desktop','AI Engineer']) {
    assert(matchesJobQuery(job(title),'software developer'),title);
    assert(!matchesJobQuery(job(title,{skills:['SQL','AWS','Go','R']}),'software developer'),title+' lacks strong evidence');
    assert(matchesJobQuery(job(title,{skills:[],description:'You have shipped production software.'}),'software developer'),title+' qualified by software work');
  }
  assert(matchesJobQuery(job('Staff Engineer, Desktop',{skills:[],description:'Recently shipped meaningful production code.'}),'software developer'));
  assert(matchesJobQuery(job('Platform Engineer',{skills:[],description:'Architect and ship the backend systems.'}),'software developer'));
});

test('explicit software titles retain support, hardware and manufacturing domains',()=>{
  for(const title of [
    'Software Engineer, Developer Support',
    'Software Engineer, Hardware Integration',
    'Senior Software Developer - Manufacturing Systems',
    'SWE, Developer Support',
  ]) {
    assert(matchesJobQuery(job(title,{skills:[]}),'software developer'),title);
    assert(matchesJobQuery(job(title,{skills:[]}),'software engineer'),title);
  }
  for(const title of ['Sales Engineer','Hardware Engineer','Technical Support Engineer'])
    assert(!matchesJobQuery(job(title),'software developer'),title);
});

test('incidental software words in a description never turn other jobs into software roles or search hits',()=>{
  const description='Work with software engineers on production software. React and Python support our team.';
  for(const title of ['Marketing Manager','Hardware Engineer','Technical Support Engineer','Sales Engineer','Mechanical Engineer','Revenue Operations','Human Evaluation Researcher'])
    assert(!matchesJobQuery(job(title,{description}),'software developer'),title);
  assert(!matchesJobQuery(job('Hardware Engineer',{company:'Software Development Inc',description}),'SWE'));
  assert(!matchesJobQuery(job('Platform Engineer',{skills:['SQL'],description:'We partner with software engineers.'}),'software developer'));
  assert(!matchesJobQuery(job('Software Engineer',{description:'We use COBOL for one system.'}),'COBOL'));
});

test('real 13-job feed finds eight conservatively qualified software roles and retains narrower queries',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/public-job-search-2026-09-19.json',import.meta.url),'utf8'));
  assert.equal(fixture.jobs.length,13);
  const titles=fixture.jobs.filter(j=>matchesJobQuery(j,'software developer')).map(j=>j.title);
  assert.deepEqual(titles,[
    'AI Engineer, Internal Systems','Staff Engineer, Desktop (Windows)','Forward Deployed Engineer',
    'Platform Engineer, Android','Platform Engineer, Enterprise','Product Engineer, Enterprise',
    'Staff Engineer, Desktop (macOS)','Lead SDET',
  ]);
  assert.equal(fixture.jobs.filter(j=>matchesJobQuery(j,'Wispr software engineer')).length,8);
  assert.deepEqual(fixture.jobs.filter(j=>matchesJobQuery(j,'software developer React')).map(j=>j.title),['Product Engineer, Enterprise']);
  assert.deepEqual(fixture.jobs.filter(j=>matchesJobQuery(j,'software developer desktop')).map(j=>j.title),['Staff Engineer, Desktop (Windows)','Staff Engineer, Desktop (macOS)']);
  assert.equal(fixture.jobs.filter(j=>matchesJobQuery(j,'software developer Nuance')).length,0);
});
