import test from 'node:test';
import assert from 'node:assert/strict';
import {loadResumeLibrary} from './resume-test-helpers.mjs';
const model=loadResumeLibrary('model');
const row=id=>({id,title:'Data Analyst',company:'Employer',url:'https://job-boards.greenhouse.io/example/jobs/'+id,location:'Chicago, IL',posted_at:null,date_basis:'unknown',search_skills:['SQL','Excel'],software_role:false,sponsorship_status:'unknown'});
function harness(handler){
  const calls=[];
  const library=loadResumeLibrary('api',{require(name){
    if(name==='./model')return model;
    if(name==='./resume-files')return {};
    if(name==='./client')return {validEmployerUrl:value=>value,rpc:async(fn,args,signal)=>{calls.push({fn,args,signal});return handler(fn,args,signal);}};
    throw new Error(name);
  },DOMException});
  return {library,calls};
}
test('compact catalog loads every page beyond 1000 jobs and preserves unknown dates, skills and sponsorship',async()=>{
  const rows=Array.from({length:1251},(_,i)=>row(i+1));
  const h=harness(async(fn,args)=>{assert.equal(fn,'fn_ss_job_catalog');const jobs=rows.filter(r=>r.id>args.p_after_id).slice(0,args.p_limit);return {ok:true,jobs,has_more:jobs.at(-1)?.id<rows.length,next_after_id:jobs.at(-1)?.id||args.p_after_id,feed_status:[]};});
  const feed=await h.library.api('jobs');
  assert.equal(feed.jobs.length,1251);assert.equal(h.calls.length,6);
  assert.deepEqual(feed.jobs.at(-1).skills,['SQL','Excel']);assert.equal(feed.jobs[0].detailsLoaded,false);
  assert.equal(feed.jobs[0].publishedAt,null);assert.equal(feed.jobs[0].dateLabel,'Posting date unavailable');
  assert.equal(feed.jobs[0].sponsorship,'unknown');assert.equal(feed.jobs[0].softwareRole,false);
});
test('detail fetch returns full employer text and forwards cancellation signal',async()=>{
  const h=harness(async(fn,args)=>{assert.equal(fn,'fn_ss_job_detail');assert.equal(args.p_job_id,17);return {ok:true,job:{...row(17),description:'Analyze financial data in SQL and Excel.'}};});
  const controller=new AbortController();const job=await h.library.api('jobs/17',{signal:controller.signal});
  assert.equal(job.detailsLoaded,true);assert.equal(job.description,'Analyze financial data in SQL and Excel.');assert.equal(h.calls[0].signal,controller.signal);
});
test('catalog refuses stuck cursors or duplicate rows rather than silently showing incomplete results',async()=>{
  const stuck=harness(async()=>({jobs:[row(1)],has_more:true,next_after_id:0}));
  await assert.rejects(stuck.library.api('jobs'),/finish loading/);
  const duplicate=harness(async()=>({jobs:[row(1)],has_more:true,next_after_id:1}));
  await assert.rejects(duplicate.library.api('jobs'),/changed while loading/);
});
test('an account change during catalog load cannot return the previous account request',async()=>{
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=h.library.api('jobs');h.library.resetAccountCache();finish({jobs:[row(1)],has_more:false,feed_status:[]});
  await assert.rejects(pending,error=>error.name==='AbortError');
});
test('shared search metadata gives compact cards the same software matching as full descriptions',()=>{
  const full={title:'Platform Engineer',company:'Example',skills:[],description:'Architect and ship the backend systems.'};
  const compact={...full,description:'',softwareRole:model.matchesJobQuery(full,'software developer')};
  assert.equal(model.matchesJobQuery(compact,'software developer'),true);
  assert.equal(model.matchesJobQuery({...compact,softwareRole:false},'software developer'),false);
});
test('real employer URL validator accepts connected custom career hosts and rejects unsafe destinations',()=>{
  const client=loadResumeLibrary('client',{require(name){if(name==='@supabase/supabase-js')return {createClient:()=>({})};throw new Error(name);}});
  for(const host of ['job-boards.greenhouse.io','boards.greenhouse.io','jobs.ashbyhq.com','jobs.lever.co','careers.duolingo.com','stripe.com','databricks.com','careers.airbnb.com','careers.datadoghq.com']) {
    const url='https://'+host+'/careers/job-123';assert.equal(client.validEmployerUrl(url),url,host);
  }
  for(const url of ['http://stripe.com/jobs/1','https://stripe.com.evil.test/jobs/1','https://user:password@stripe.com/jobs/1','javascript:alert(1)','https://stripe.com/jobs/bad url','http://careers.datadoghq.com/detail/6572669/','https://careers.datadoghq.com.evil.test/detail/6572669/','https://evil.careers.datadoghq.com/detail/6572669/','https://user:password@careers.datadoghq.com/detail/6572669/','https://datadoghq.com/detail/6572669/'])assert.equal(client.validEmployerUrl(url),null,url);
});
test('restricted sponsorship evidence is not mislabeled as an absent statement',()=>{
  assert.equal(model.sponsorshipLabel({sponsorship:'unknown',evidence:'H-1B transfers only.'}),'Sponsorship restrictions stated');
  assert.equal(model.sponsorshipLabel({sponsorship:'unknown',evidence:''}),'Sponsorship not stated');
});
