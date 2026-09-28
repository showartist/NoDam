import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('meeting review tools — synthetic DB/audio, no provider calls',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'nodam-review-'));process.env.SCENENOTE_DB=path.join(dir,'db');process.env.SCENENOTE_DATA_DIR=dir;
 const audio=path.join(dir,'transcription-jobs','source.mp3');mkdirSync(path.dirname(audio));writeFileSync(audio,Buffer.from('0123456789'));
 const {db}=await import('../lib/db');const {createIntake}=await import('../lib/meetingIntake/store');
 const {getMeetingUtterances,createRun,finishRun}=await import('../lib/alignment/store');const {beginAnalysisJob,analysisSourceChanged}=await import('../lib/alignment/jobs');
 const {replaceMeetingTranscript}=await import('../lib/transcription/save');const {getAudioSource}=await import('../lib/transcription/source');const {audioReviewFlags}=await import('../lib/transcription/review');
 const {editSpeakers}=await import('../lib/meetingIntake/edit');const {GET:listen}=await import('../app/api/meetings/[id]/audio/route');const {PATCH:edit}=await import('../app/api/meetings/[id]/speaker-edit/route');
 const {assembleAll}=await import('../lib/alignment/assemble');const {buildSpeakerLabels}=await import('../lib/alignment/prompt');const {settledIssues}=await import('../lib/alignment/settled');
 const {getDecisionBoard,changeDecisionBoard}=await import('../lib/meetingDecisions/store');
 const result={provider:'synthetic',model:'synthetic',language:'ko',text:'입장 시간을 확인해주세요 네 20분으로 진행합니다',durationMs:3000,sourceFileName:'synthetic.mp3',diarizationStatus:'ok' as const,speakerCount:2,utterances:[{speakerId:'A',speakerName:null,startMs:0,endMs:1000,text:'입장 시간을 확인해주세요',confidence:null},{speakerId:'B',speakerName:null,startMs:2000,endMs:3000,text:'네 20분으로 진행합니다',confidence:null}]};
 const meeting=(source=true)=>{const {meetingId}=createIntake({requestId:crypto.randomUUID(),title:'합성 검증 전용',purpose:'기능 검증',kind:'discussion',mode:'audio',sourceType:'actual'});replaceMeetingTranscript(meetingId,result,'synthetic',source?{file:audio,flags:[]}:undefined);return meetingId;};
 const input=(id:string)=>({speakerName:'직접 확인한 참가자',turns:getMeetingUtterances(id).map(u=>({uid:u.uid,expectedText:u.text,expectedSpeakerName:u.speakerName,expectedSpeakerKey:u.speakerKey}))});
 const audioReq=(id:string,range?:string)=>listen(new Request('http://local/audio',{headers:range?{range}:{}}),{params:Promise.resolve({id})});
 try{
 await t.test('batch correction merges selected speakers, preserves words/raw/audit, invalidates analysis',()=>{
  const id=meeting(),before=getMeetingUtterances(id),run=beginAnalysisJob(id,'synthetic',null,before);finishRun(run,{status:'completed'});
  assert.deepEqual(editSpeakers(id,input(id)),{ok:true,updated:2});assert.deepEqual(getMeetingUtterances(id).map(u=>u.text),before.map(u=>u.text));assert.deepEqual([...new Set(getMeetingUtterances(id).map(u=>u.speakerKey))],['N:직접 확인한 참가자']);assert.equal(analysisSourceChanged(run,id),true);
  const audit=db().prepare('SELECT before_json FROM utterance_edits WHERE meeting_id=?').all(id) as {before_json:string}[];assert.equal(audit.length,2);assert.equal(JSON.parse(audit[1].before_json).speakerId,'B');
  assert.deepEqual(db().prepare('SELECT text_raw FROM utterances WHERE meeting_id=? ORDER BY idx').all(id).map((r:any)=>r.text_raw),before.map(u=>u.text));
 });
 await t.test('stale, duplicate, foreign or active selections fail atomically; cross-origin denied',async()=>{
  const id=meeting(),value=input(id);const stale=structuredClone(value);stale.turns[1].expectedSpeakerKey='wrong';assert.throws(()=>editSpeakers(id,stale),/다른 수정/);assert.equal(getMeetingUtterances(id)[0].speakerName,null);
  assert.throws(()=>editSpeakers(id,{...value,turns:[value.turns[0],value.turns[0]]}),/중복/);
  assert.throws(()=>editSpeakers(id,{...value,turns:[value.turns[0],{...value.turns[1],uid:'OTHER-MEETING'}]}),/발언을 찾을/);assert.equal(getMeetingUtterances(id)[0].speakerName,null);
  const r=await edit(new Request('http://local/speaker-edit',{method:'PATCH',headers:{origin:'http://foreign'},body:JSON.stringify(value)}),{params:Promise.resolve({id})});assert.equal(r.status,403);
  const run=createRun(id,'live','synthetic');db().prepare("INSERT INTO live_sessions(id,meeting_id,run_id,mode,status,started_at)VALUES(?,?,?,'mic','recording','now')").run(crypto.randomUUID(),id,run);assert.throws(()=>editSpeakers(id,value),/종료 처리가 끝난/);
 });
 await t.test('partial selection leaves other speakers untouched and HTTP PATCH persists',async()=>{
  const id=meeting(),value=input(id);value.turns=value.turns.slice(0,1);const r=await edit(new Request('http://local/speaker-edit',{method:'PATCH',body:JSON.stringify(value)}),{params:Promise.resolve({id})});assert.equal(r.status,200);assert.equal((await r.json()).updated,1);assert.equal(getMeetingUtterances(id)[1].speakerId,'B');
 });
 await t.test('audio streams exact bytes for full, bounded, suffix and open ranges',async()=>{
  const id=meeting();for(const [range,status,text] of [[undefined,200,'0123456789'],['bytes=2-5',206,'2345'],['bytes=-3',206,'789'],['bytes=8-',206,'89']] as const){const r=await audioReq(id,range);assert.equal(r.status,status);assert.equal(await r.text(),text);assert.match(r.headers.get('cache-control')!,/no-store/);}
  for(const range of ['bytes=10-','bytes=3-1','bytes=-0','bytes=0-1,4-5','garbage','bytes=-'])assert.equal((await audioReq(id,range)).status,416);
  assert.equal((await audioReq('different-meeting')).status,404);assert.equal((await audioReq(meeting(false))).status,404);
 });
 await t.test('a newer transcript cannot accidentally play old audio; failed registration rolls back',()=>{
  const id=meeting();assert.ok(getAudioSource(id));replaceMeetingTranscript(id,result,'new-synthetic');assert.equal(getAudioSource(id),null);
  const external=path.join(dir,'outside.mp3');writeFileSync(external,'private');assert.throws(()=>replaceMeetingTranscript(id,{...result,utterances:[]},'bad',{file:external,flags:[]}),/保存|저장된/);assert.equal(getMeetingUtterances(id).length,2);
  const link=path.join(path.dirname(audio),'symlink.mp3');symlinkSync(external,link);assert.throws(()=>replaceMeetingTranscript(id,result,'bad',{file:link,flags:[]}),/저장된/);
 });
 await t.test('review cues retain repeated speech and expose empty chunks/boundary overlap without claiming errors',()=>{
  const words=[{text:'네',startMs:27000,endMs:29500,speaker:'C1-A'},{text:'네',startMs:29000,endMs:30000,speaker:'C2-B'}],before=JSON.stringify(words);
  const flags=audioReviewFlags([{index:0,offsetMs:0,durationMs:27000,words:0},{index:1,offsetMs:27000,durationMs:33000,words:2}],words);assert.deepEqual(flags.map(f=>f.kind),['empty_chunk','boundary_overlap']);assert.equal(JSON.stringify(words),before);assert.equal(audioReviewFlags([],words.map(w=>({...w,speaker:'C1-A'}))).length,0);
 });
 await t.test('settled candidate can be reopened with later evidence, without generating approval; stale imports rejected',()=>{
  const id=meeting(),turns=getMeetingUtterances(id),runId=beginAnalysisJob(id,'synthetic',null,turns);
  const issue=assembleAll({issues:[{key:'entry',type:'missing_information',decision:'입장 시간',concept:'입장',state:'open',condition:null,positions:[{speaker:'S1',meaning:'입장 시간을 확인',quote:turns[0].text,evidence:['U-001'],slots:[]}],question:'언제 입장하나요?',why_it_matters:'안내',severity:'medium',role_briefs:[]}],agreements:[]},{meetingId:id,runId,dataMode:'fixture',utts:turns,labels:buildSpeakerLabels(turns),window:null}).issues[0];assert.ok(issue);
  const stats={context:{settledIssues:[{issue_id:issue.issue_id,evidence:['U-002'],note:'합성 후속 수용',issue}]}};finishRun(runId,{status:'completed',stats});assert.equal(settledIssues(JSON.stringify(stats))[0].issue?.decision,'입장 시간');
  const b=changeDecisionBoard(id,0,{action:'import_analysis',runId,issueId:issue.issue_id});assert.equal(b.questions.length,1);assert.deepEqual(b.questions[0].evidence.map(e=>e.uid),['U-001','U-002']);assert.equal(b.questions[0].confirmedAt,null);assert.deepEqual(b.questions[0].responses,[]);assert.equal(getDecisionBoard(id).participants.length,0);
  assert.equal(changeDecisionBoard(id,b.revision,{action:'import_analysis',runId,issueId:issue.issue_id}).questions.length,1);
  editSpeakers(id,input(id));assert.throws(()=>changeDecisionBoard(id,b.revision,{action:'import_analysis',runId,issueId:issue.issue_id}),/화자가 수정/);
  assert.equal(settledIssues('{malformed').length,0);assert.equal(settledIssues(JSON.stringify({context:{settledIssues:[{issue_id:'legacy',evidence:['U1'],note:'이전 기록'}]}})).length,1);
 });
 }finally{db().close();rmSync(dir,{recursive:true,force:true});}
});
