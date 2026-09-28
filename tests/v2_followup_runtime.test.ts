import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

test('v2 follow-up: stale live evidence and retryable finish — synthetic fault injection',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'nodam-followup-'));
 process.env.SCENENOTE_DB=path.join(dir,'test.db');
 const oldKey=process.env.OPENROUTER_API_KEY,oldFetch=globalThis.fetch;
 process.env.OPENROUTER_API_KEY='synthetic-no-network';
 let calls=0,fail=false,findings=false;
 globalThis.fetch=async(url,init)=>{
  if(String(url).includes('/endpoints'))return Response.json({data:{endpoints:[{supported_parameters:['structured_outputs','max_tokens']}]}});
  calls++;if(fail)throw new Error('synthetic model failure');
  const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages[1].content);
  return Response.json({choices:[{message:{content:JSON.stringify({focus:'on_topic',latestRelation:'on_topic',summary:'합성 검토',findings:findings?[{kind:'meaning_gap',summary:'따뜻함의 차이',question:'따뜻함의 표현을 확인할까요?',evidence:input.current.slice(0,2).map((u:any)=>({uid:u.uid,quote:u.text,context:'current',role:'signal'}))}]:[]})}}],usage:{prompt_tokens:1,completion_tokens:1,cost:0}});
 };
 const {db}=await import('../lib/db');const d=db();
 const {createIntake}=await import('../lib/meetingIntake/store');
 const {startSession,stopSession,LIVE_DIR}=await import('../lib/live/session');
 const {advanceFacilitator,getFacilitatorState,reviewSourceChanged}=await import('../lib/facilitator/store');
 const {editUtterance}=await import('../lib/meetingIntake/edit');
 const {getMeetingUtterances}=await import('../lib/alignment/store');
 const {getDecisionBoard,changeDecisionBoard}=await import('../lib/meetingDecisions/store');
 const {POST:stop}=await import('../app/api/meetings/[id]/live/stop/route');
 const {GET:state}=await import('../app/api/meetings/[id]/live/state/route');
 const create=()=>{const id=createIntake({requestId:randomUUID(),title:'합성 오류 복구',purpose:'따뜻함의 표현을 서로 확인합니다',kind:'discussion',mode:'live',sourceType:'actual',text:''}).meetingId;return {id,e:startSession(id,'mic',{facilitator:{goal:'따뜻함의 표현을 서로 확인합니다',intervalMinutes:3}})};};
 const turn=(id:string,index:number,name:string,text:string,end:number)=>d.prepare('INSERT INTO utterances(id,meeting_id,idx,uid,speaker_name,text_clean,text_raw,start_ms,end_ms,created_at)VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,index,`U${index+1}`,name,text,text,end-500,end,new Date().toISOString());
 const request=(id:string,sessionId:string)=>stop(new Request('http://local/stop',{method:'POST',body:JSON.stringify({sessionId})}),{params:Promise.resolve({id})});
 const wav=path.join(dir,'valid.wav');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','1',wav]);
 const chunk=(e:any,file:string,duration=1000)=>d.prepare("INSERT INTO live_chunks(session_id,idx,offset_ms,duration_ms,file_path,status,created_at)VALUES(?,0,0,?,?,'done','now')").run(e.sessionId,duration,file);
 try{
 await t.test('live snapshot survives later speech, blocks speaker-only edit at import and confirmation',async()=>{
  findings=true;const {id,e}=create();turn(id,0,'민지','따뜻함은 가족 얼굴입니다.',1000);turn(id,1,'준호','따뜻함은 빈 부엌입니다.',2000);
  await advanceFacilitator(e.sessionId,3000,true);
  const review=getFacilitatorState(id)!.reviews[0];assert.ok(d.prepare('SELECT source_json FROM facilitator_review_sources WHERE review_id=?').get(review.id));
  turn(id,2,'나중','뒤에 추가된 발언',4000);assert.equal(reviewSourceChanged(id,review.id),false);
  let b=changeDecisionBoard(id,0,{action:'import',reviewId:review.id,findingIndex:0});
  // Simulate completed recording to enable human correction; preserves the actual saved review.
  d.prepare("UPDATE live_sessions SET status='stopped' WHERE id=?").run(e.sessionId);
  const u=getMeetingUtterances(id)[1];editUtterance(id,{uid:u.uid,text:u.text,speakerName:'민지',expectedText:u.text,expectedSpeakerName:u.speakerName});
  assert.equal(getFacilitatorState(id)!.reviews[0].sourceChanged,true);
  assert.throws(()=>changeDecisionBoard(id,b.revision,{action:'import',reviewId:review.id,findingIndex:0}),/발언·화자가 수정/);
  assert.throws(()=>changeDecisionBoard(id,b.revision,{action:'confirm',questionId:b.questions[0].id}),/발언·화자가 수정/);
  assert.equal(getDecisionBoard(id).questions[0].sourceChanged,true);
  assert.ok(getDecisionBoard(id).questions[0].blockers.some(x=>x.includes('분석 근거')));
  // Old reviews without a snapshot must also honor edit history.
  d.prepare('DELETE FROM facilitator_review_sources WHERE review_id=?').run(review.id);
  assert.equal(reviewSourceChanged(id,review.id),true);
 });
 await t.test('confirmed live decision remains immutable with visible later source change',async()=>{
  findings=true;const {id,e}=create();turn(id,0,'가','따뜻함은 가족입니다.',1000);turn(id,1,'나','따뜻함은 색입니다.',2000);await advanceFacilitator(e.sessionId,3000,true);
  const review=getFacilitatorState(id)!.reviews[0];let b=changeDecisionBoard(id,0,{action:'import',reviewId:review.id,findingIndex:0});
  b=changeDecisionBoard(id,b.revision,{action:'participant',name:'진행자',role:''});const q=b.questions[0].id,p=b.participants[0].id;
  b=changeDecisionBoard(id,b.revision,{action:'proposal',questionId:q,proposal:'가족 표현',ownerId:p,dueDate:null,criteria:'시안 확인'});
  b=changeDecisionBoard(id,b.revision,{action:'response',questionId:q,participantId:p,stance:'agree',understanding:'가족 표현'});
  b=changeDecisionBoard(id,b.revision,{action:'confirm',questionId:q});const snapshot=JSON.stringify(b.questions[0]);
  d.prepare("UPDATE live_sessions SET status='stopped' WHERE id=?").run(e.sessionId);const u=getMeetingUtterances(id)[0];editUtterance(id,{uid:u.uid,text:'정정한 발언',speakerName:u.speakerName,expectedText:u.text,expectedSpeakerName:u.speakerName});
  const after=getDecisionBoard(id);assert.equal(after.questions[0].confirmedAt,b.questions[0].confirmedAt);assert.equal(after.questions[0].sourceChanged,true);
  assert.equal(after.questions[0].evidence[0].quote,JSON.parse(snapshot).evidence[0].quote);
  assert.ok(after.history.some((x:any)=>x.action==='confirm'&&x.detail_json.includes('confirmedSnapshot')));
 });
 await t.test('invalid merged audio returns 502, preserves chunks and can retry without mic',async()=>{
  findings=false;const {id,e}=create();const file=path.join(dir,'broken.wav');writeFileSync(file,'invalid wav');chunk(e,file);
  const first=await request(id,e.sessionId);assert.equal(first.status,502);assert.match((await first.json()).error,/합치기/);
  const row=d.prepare('SELECT * FROM live_sessions WHERE id=?').get(e.sessionId) as any;assert.ok(row.stopped_at);assert.equal(row.full_audio,null);assert.notEqual(row.status,'stopped');assert.equal(readFileSync(file,'utf8'),'invalid wav');
  writeFileSync(file,readFileSync(wav));const second=await request(id,e.sessionId);assert.equal(second.status,200);
  const done=d.prepare('SELECT * FROM live_sessions WHERE id=?').get(e.sessionId) as any;assert.ok(existsSync(done.full_audio));assert.equal(done.stopped_at,row.stopped_at);assert.equal(done.error,null);
  assert.equal((await request(id,e.sessionId)).status,200);
 });
 await t.test('missing done chunk cannot silently disappear from full recording',async()=>{
  const {id,e}=create();chunk(e,path.join(dir,'missing.wav'));const r=await request(id,e.sessionId);assert.equal(r.status,502);assert.match((await r.json()).error,/누락/);assert.equal((d.prepare('SELECT full_audio FROM live_sessions WHERE id=?').get(e.sessionId) as any).full_audio,null);
 });
 await t.test('last failed window retries after engine restart without repeating successful window',async()=>{
  findings=false;const {id,e}=create();turn(id,0,'가','첫 구간',1000);turn(id,1,'나','마지막 구간',181000);chunk(e,wav,181000);e.mediaEndMs=181000;
  await advanceFacilitator(e.sessionId,180000);assert.equal(getFacilitatorState(id)!.reviews.length,1);
  fail=true;const r=await request(id,e.sessionId);assert.equal(r.status,502);const ended=(d.prepare('SELECT stopped_at FROM live_sessions WHERE id=?').get(e.sessionId) as any).stopped_at;
  assert.equal(getFacilitatorState(id)!.processedMs,180000);const before=calls;
  (globalThis as any).__scenenoteLive.delete(e.sessionId);fail=false;
  assert.equal((await request(id,e.sessionId)).status,200);assert.equal(calls,before+1);
  assert.equal(getFacilitatorState(id)!.reviews.length,2);assert.equal(getFacilitatorState(id)!.processedMs,181000);
  assert.equal((d.prepare('SELECT stopped_at FROM live_sessions WHERE id=?').get(e.sessionId) as any).stopped_at,ended);
  assert.equal((await request(id,e.sessionId)).status,200);assert.equal(calls,before+1);
 });
 await t.test('legacy stopped session with failed analysis exposes finish retry and recovers',async()=>{
  const {id,e}=create();turn(id,0,'가','종료 전 발언',1000);chunk(e,wav);e.mediaEndMs=1000;
  d.prepare("UPDATE live_sessions SET status='stopped',stopped_at='2026-09-28T00:00:00Z' WHERE id=?").run(e.sessionId);d.prepare("UPDATE alignment_v2_runs SET status='failed' WHERE id=?").run(e.runId);(globalThis as any).__scenenoteLive.delete(e.sessionId);
  const snapshot=await (await state(new Request('http://local/state'),{params:Promise.resolve({id})})).json();assert.equal(snapshot.session.status,'interrupted');assert.ok(snapshot.session.stopped_at);
  assert.equal((await request(id,e.sessionId)).status,200);assert.equal(getFacilitatorState(id)!.reviews.length,1);
 });
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;d.close();}
});
