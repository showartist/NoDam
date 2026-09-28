import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('long meeting quality — synthetic speaker and resolution regressions',async t=>{
 process.env.SCENENOTE_DB=path.join(mkdtempSync(path.join(tmpdir(),'nodam-quality-')),'test.db');
 const {db}=await import('../lib/db');const {createIntake}=await import('../lib/meetingIntake/store');
 const {replaceMeetingTranscript}=await import('../lib/transcription/save');const {getMeetingUtterances}=await import('../lib/alignment/store');
 const {buildSpeakerLabels}=await import('../lib/alignment/prompt');const {assembleAll}=await import('../lib/alignment/assemble');
 const {conditionPhrase}=await import('../lib/alignment/checks');const {runContextChecks}=await import('../lib/alignment/context');
 const mk=(id:string,idx:number,key:string|null,text:string)=>({uid:id,idx,speakerKey:key,speakerId:key,speakerName:null,role:null,text,startMs:idx*1000,endMs:idx*1000+900});
 const issue=(type:string,speaker='S1')=>({key:'open-time',type,decision:'관람객 입장 시간',concept:'입장',state:'open',condition:null,positions:[{speaker,meaning:'입장 시간 확인',quote:'입장 시간을 확인해주세요',evidence:['U1'],slots:[]}],question:'언제 입장하나요?',why_it_matters:'안내 일정',severity:'medium',role_briefs:[]});
 await t.test('unverified legacy chunk ids are not treated as different people; manual correction survives',()=>{
  const {meetingId}=createIntake({requestId:crypto.randomUUID(),title:'합성 화자 검사',purpose:'합성',kind:'discussion',mode:'audio',sourceType:'actual'});
  replaceMeetingTranscript(meetingId,{provider:'test',model:'test',language:'ko',text:'합성',durationMs:1000,sourceFileName:'synthetic.wav',diarizationStatus:'unsupported',speakerCount:null,utterances:[{speakerId:'SPEAKER_144',speakerName:null,startMs:0,endMs:1000,text:'입장 시간을 확인해주세요',confidence:null}]},'chunked+none');
  assert.equal(getMeetingUtterances(meetingId)[0].speakerKey,null);assert.equal(getMeetingUtterances(meetingId)[0].speakerId,null);
  db().prepare('UPDATE utterances SET speaker_id=NULL,speaker_name=? WHERE meeting_id=?').run('참가자 가',meetingId);
  assert.equal(getMeetingUtterances(meetingId)[0].speakerKey,'N:참가자 가');
 });
 await t.test('unknown speakers retain evidenced questions without fabricating interpersonal conflict',()=>{
  const utts=[mk('U1',0,null,'입장 시간을 확인해주세요')];const ctx={meetingId:'m',runId:'r',dataMode:'fixture' as const,utts,labels:buildSpeakerLabels(utts),window:null};
  const out=assembleAll({issues:[issue('missing_information','S?')] as any,agreements:[]},ctx);
  assert.equal(out.issues.length,1);assert.equal(out.issues[0].positions[0].speaker.key,null);assert.equal(out.issues[0].positions[0].checks.speaker,'unknown_speaker');
  assert.equal(assembleAll({issues:[issue('interpretation_gap','S?')] as any,agreements:[]},ctx).issues.length,0);
  assert.equal(assembleAll({issues:[issue('missing_information','invented')] as any,agreements:[]},ctx).issues.length,0);
 });
 await t.test('a filler word alone does not invent a condition; explicit dependencies still do',()=>{
  assert.equal(conditionPhrase('일단. 그럼 맨바닥으로 하죠.'),null);
  assert.ok(conditionPhrase('안전관리자 확인 전에는 승인할 수 없습니다.'));
  assert.ok(conditionPhrase('실제 모양을 보고 정하겠습니다.'));
 });
 await t.test('resolution judge reads later acceptance and rejects invented evidence; failures remain visible',async()=>{
  const utts=[mk('U1',0,'A','입장 시간을 확인해주세요'),...Array.from({length:40},(_,i)=>mk(`F${i}`,i+1,'B','다른 안건을 논의합니다.')),mk('U42',42,'B','입장은 20분 전으로 진행해도 문제 없습니다.')];
  const built=assembleAll({issues:[issue('missing_information')] as any,agreements:[]},{meetingId:'m',runId:'r',dataMode:'fixture',utts,labels:buildSpeakerLabels(utts),window:null}).issues;
  const original=globalThis.fetch,key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='synthetic-only';let verdict='settled',evidence=['U42'],bad=false;
  globalThis.fetch=async(url,init)=>{if(String(url).includes('/endpoints'))return Response.json({data:{endpoints:[{supported_parameters:['max_tokens']}]}});if(bad)throw Error('synthetic failure');const body=JSON.parse(String(init?.body));assert.ok(body.messages[1].content.includes('입장은 20분 전으로 진행해도 문제 없습니다.'));return Response.json({choices:[{message:{content:JSON.stringify({resolution:{verdict,evidence,note:'후속 발언'},positions:[{index:0,verdict:'supported',note:'근거 있음'}],slot_pairs:[]})}}]});};
  try{
   let r=await runContextChecks(built,utts,{useCache:false});assert.equal(r.issues.length,0);assert.equal(r.stats.settledIssues.length,1);assert.equal(r.stats.settledIssues[0].issue.question,built[0].question);
   evidence=['FAKE'];r=await runContextChecks(built,utts,{useCache:false});assert.equal(r.issues.length,1);
   evidence=['U42'];verdict='open';r=await runContextChecks(built,utts,{useCache:false});assert.equal(r.issues.length,1);
   bad=true;r=await runContextChecks(built,utts,{useCache:false});assert.equal(r.issues.length,1);assert.equal(r.stats.failures,1);
  }finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;}
 });
 db().close();
});
