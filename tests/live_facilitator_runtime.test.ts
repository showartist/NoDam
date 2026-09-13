import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('synthetic runtime: durable chunk ack, duplicate suppression, meeting scope and saved purpose review',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'live-facilitator-')),oldFetch=globalThis.fetch;
 process.env.SCENENOTE_DB=path.join(dir,'test.db');process.env.OPENROUTER_API_KEY='injected-test';
 let transcriptions=0,analyses=0, failTranscription=false;
 try{
  globalThis.fetch=(async(url:any,init?:RequestInit)=>{
   if(String(url).includes('/audio/transcriptions')){transcriptions++;if(failTranscription)return Response.json({error:{message:'injected failure'}},{status:400});return Response.json({text:'책상 배치를 정합시다.',words:[{word:'책상 배치를 정합시다.',start:0,end:.8,speaker:0}]});}
   if(String(url).includes('/endpoints'))return Response.json({data:{endpoints:[{supported_parameters:['structured_outputs','max_tokens']}]}});
   if(String(url).includes('/chat/completions')){analyses++;const body=JSON.parse(String(init?.body));assert.match(body.messages[1].content,/책상 배치/);return Response.json({choices:[{message:{content:JSON.stringify({focus:'on_topic',latestRelation:'on_topic',summary:'목적 관련 논의',findings:[]})}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});}
   throw new Error('Synthetic test: no speaker sidecar');
  }) as typeof fetch;
  const {db}=await import('../lib/db');
  const {startSession,ingestChunk,stopSession,resumeSession}=await import('../lib/live/session');
  const {advanceFacilitator,getFacilitatorState}=await import('../lib/facilitator/store');
  const {POST}=await import('../app/api/meetings/[id]/live/chunk/route');
  const d=db();d.prepare("INSERT INTO projects(id,title,domain,created_at)VALUES('p','test','meeting','now')").run();d.prepare("INSERT INTO meetings(id,project_id,raw_transcript,created_at)VALUES('m','p','','now')").run();
  const e=startSession('m','mic',{facilitator:{goal:'사무실의 책상 배치를 결정한다.',intervalMinutes:3}});
  const wav=path.join(dir,'tone.wav');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','1',wav]);const bytes=readFileSync(wav);
  await ingestChunk(e.sessionId,{bytes,ext:'wav',offsetMs:0});
  await ingestChunk(e.sessionId,{bytes,ext:'wav',offsetMs:0});
  assert.equal(transcriptions,1);assert.equal((d.prepare('SELECT COUNT(*) n FROM live_chunks').get() as any).n,1);
  const fd=new FormData();fd.append('file',new File([bytes],'a.wav'));fd.append('sessionId',e.sessionId);fd.append('offsetMs','1000');
  const wrong=await POST(new Request('http://localhost',{method:'POST',body:fd}),{params:Promise.resolve({id:'other-meeting'})});assert.equal(wrong.status,404);
  const row=d.prepare('SELECT * FROM live_chunks').get() as any;assert.equal(row.status,'done');assert.ok(row.file_path);
  await advanceFacilitator(e.sessionId,180000);
  assert.equal(analyses,1);const state=getFacilitatorState('m')!;assert.equal(state.reviews.length,1);assert.equal(state.reviews[0].assessed.notification,null);assert.equal(state.processedMs,180000);
  await advanceFacilitator(e.sessionId,180000);assert.equal(analyses,1);
  (globalThis as any).__scenenoteLive.clear();
  const recovered=resumeSession('m',e.sessionId);await recovered.queue;
  assert.equal(transcriptions,1);assert.equal(getFacilitatorState('m')!.reviews.length,1);
  await stopSession(e.sessionId);
  const inactive=await POST(new Request('http://localhost',{method:'POST',body:fd}),{params:Promise.resolve({id:'m'})});assert.equal(inactive.status,404);
  d.prepare("INSERT INTO meetings(id,project_id,raw_transcript,created_at)VALUES('failure','p','','now')").run();
  const broken=startSession('failure','mic',{facilitator:{goal:'사무실의 책상 배치를 결정한다.',intervalMinutes:3}});
  failTranscription=true;
  const callsBefore=transcriptions;
  await ingestChunk(broken.sessionId,{bytes,ext:'wav',offsetMs:0});
  await ingestChunk(broken.sessionId,{bytes,ext:'wav',offsetMs:1000});
  assert.equal(transcriptions,callsBefore+1,'later audio must wait for the failed chunk');
  const statuses=()=>d.prepare('SELECT status FROM live_chunks WHERE session_id=? ORDER BY idx').all(broken.sessionId).map((r:any)=>r.status);
  assert.deepEqual(statuses(),['failed','queued']);
  await assert.rejects(()=>stopSession(broken.sessionId),/전사가 남았습니다/);
  assert.equal(broken.stopping,false,'failed finish must remain recoverable');
  (globalThis as any).__scenenoteLive.clear();
  const interrupted=resumeSession('failure',broken.sessionId);await interrupted.queue;
  assert.equal(transcriptions,callsBefore+2,'restart also preserves failed-first ordering');
  assert.deepEqual(statuses(),['failed','queued']);
  failTranscription=false;
  const retry=resumeSession('failure',broken.sessionId);
  const concurrent=ingestChunk(retry.sessionId,{bytes,ext:'wav',offsetMs:2000});
  await concurrent;
  assert.deepEqual(statuses(),['done','done','done']);
  assert.equal(transcriptions,callsBefore+5);
  const recoveredTurns=d.prepare("SELECT start_ms FROM utterances WHERE meeting_id='failure' ORDER BY idx").all() as any[];
  assert.deepEqual(recoveredTurns.map(r=>r.start_ms),[0,1000,2000]);
  await stopSession(broken.sessionId);
  console.log('failure recovery: failed+queued → stop rejected → restart ordered → retry done+done, no duplicates');
  console.log('runtime: STT calls=1, review calls=1, duplicate=false, cross-meeting=404, stopped-session=404, review-persisted=true');
 }finally{globalThis.fetch=oldFetch;rmSync(dir,{recursive:true,force:true});}
});
