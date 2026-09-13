import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import path from 'node:path';import {tmpdir} from 'node:os';
test('synthetic sharing runtime: explicit opt-in, ordered server snapshots, no key in response, revoke',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'scenenote-sharing-')),cwd=process.cwd(),oldFetch=globalThis.fetch;process.env.SCENENOTE_DB=path.join(dir,'test.db');
 try{
  process.chdir(dir);mkdirSync('.data/sharing',{recursive:true});writeFileSync('.data/sharing/config.json',JSON.stringify({origin:'https://synthetic.chatgpt.site',writeKey:'synthetic-test-only'}));
  const {db}=await import('../lib/db');const {shareState,updateShare}=await import('../lib/sharing/liveShare');const d=db();
  d.prepare("INSERT INTO projects(id,title,domain,created_at)VALUES('p','synthetic','meeting','now')").run();d.prepare("INSERT INTO meetings(id,project_id,raw_transcript,created_at)VALUES('m','p','','now')").run();
  const calls:{method:string;body:any}[]=[];
  globalThis.fetch=(async(url:any,options?:RequestInit)=>{assert.match(String(url),/^https:\/\/synthetic.chatgpt.site\/api\/shared\/[a-f0-9]{48}$/);assert.equal((options?.headers as any).authorization,'Bearer synthetic-test-only');calls.push({method:options?.method??'',body:options?.body?JSON.parse(String(options.body)):null});return Response.json({ok:true});}) as typeof fetch;
  assert.equal(shareState('m').enabled,false);await updateShare('m','sync');assert.equal(calls.length,0);
  const enabled=await updateShare('m','start');assert.equal(enabled.enabled,true);assert.match(enabled.url!,/\/live\/[a-f0-9]{48}$/);assert.ok(!JSON.stringify(enabled).includes('synthetic-test-only'));
  await Promise.all([updateShare('m','sync'),updateShare('m','sync')]);assert.deepEqual(calls.map(c=>c.body.revision),[1,2,3]);
  assert.deepEqual(Object.keys(calls[0].body).sort(),['goal','intervalMinutes','reviews','revision','status','utterances']);
  await updateShare('m','stop');assert.equal(calls.at(-1)?.method,'DELETE');assert.equal(shareState('m').enabled,false);await updateShare('m','sync');assert.equal(calls.length,4);
 }finally{process.chdir(cwd);globalThis.fetch=oldFetch;rmSync(dir,{recursive:true,force:true});}
});
