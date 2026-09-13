import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

test("meeting decisions runtime (synthetic records, no external model)",async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),"scenenote-decisions-"));process.env.SCENENOTE_DB=path.join(dir,"test.db");
 const {db}=await import("../lib/db");
 const {getDecisionBoard,changeDecisionBoard}=await import("../lib/meetingDecisions/store");
 const {GET,POST}=await import("../app/api/meetings/[id]/decisions/route");
 const d=db();d.prepare("INSERT INTO projects(id,title,domain,created_at)VALUES('p','synthetic','meeting','now')").run();
 let number=0;
 function meeting(){const id=`m${++number}`;d.prepare("INSERT INTO meetings(id,project_id,raw_transcript,created_at)VALUES(?,'p','','now')").run(id);d.prepare("INSERT INTO utterances(id,meeting_id,idx,uid,text_raw,text_clean,created_at)VALUES(?,?,0,'U-001',?,?, 'now')").run('u'+id,id,'통로를 넓히고 책상을 옮깁시다.','통로를 넓히고 책상을 옮깁시다.');return id;}
 const cmd=(id:string,command:unknown)=>changeDecisionBoard(id,getDecisionBoard(id).revision,command);
 function setup(){const id=meeting();cmd(id,{action:'participant',name:'가',role:'설계'});cmd(id,{action:'participant',name:'나',role:'제작'});cmd(id,{action:'question',question:'통로 폭을 확인할까요?',evidence:[{uid:'U-001',quote:'통로를 넓히고'}]});const b=getDecisionBoard(id),q=b.questions[0];cmd(id,{action:'proposal',questionId:q.id,proposal:'통로 폭을 재고 배치를 정한다.',ownerId:b.participants[0].id,dueDate:null,criteria:'실측 결과와 배치도 확인'});return{id,qid:q.id,people:b.participants};}
 const response=(id:string,qid:string,pid:string,stance='agree')=>cmd(id,{action:'response',questionId:qid,participantId:pid,stance,understanding:'통로 폭을 실측한 다음 결정한다.'});
 try{
 await t.test('source: missing meeting/UID and invented quote rejected',()=>{const id=meeting();assert.throws(()=>getDecisionBoard('missing'),/회의를 찾을/);for(const e of [{uid:'U-404',quote:'통로'},{uid:'U-001',quote:'전원 찬성'}])assert.throws(()=>cmd(id,{action:'question',question:'확인 질문',evidence:[e]}),/원문과 맞지/);assert.equal(getDecisionBoard(id).questions.length,0);});
 await t.test('no people or proposal cannot become confirmed',()=>{const id=meeting();cmd(id,{action:'question',question:'확인 질문',evidence:[{uid:'U-001',quote:'통로'}]});const q=getDecisionBoard(id).questions[0];assert.throws(()=>cmd(id,{action:'confirm',questionId:q.id}),/참가자/);assert.equal(getDecisionBoard(id).questions[0].confirmedAt,null);});
 await t.test('silence, disagreement and uncertainty block confirmation',()=>{const {id,qid,people}=setup();response(id,qid,people[0].id);assert.throws(()=>cmd(id,{action:'confirm',questionId:qid}),/아직 확인/);for(const stance of ['disagree','uncertain']){response(id,qid,people[1].id,stance);assert.throws(()=>cmd(id,{action:'confirm',questionId:qid}),/남았습니다/);}});
 await t.test('consent with concerns confirms and preserves concern in reload and confirmation history',async()=>{
  const {id,qid,people}=setup();response(id,qid,people[0].id);
  const concern='배치 변경으로 제작 비용이 늘어날 우려가 있지만 실측 진행에는 동의합니다.';
  cmd(id,{action:'response',questionId:qid,participantId:people[1].id,stance:'agree_with_concerns',understanding:'먼저 폭을 실측하고 최종 배치를 결정한다.',concern});
  assert.deepEqual(getDecisionBoard(id).questions[0].blockers,[]);
  cmd(id,{action:'confirm',questionId:qid});cmd(id,{action:'task',questionId:qid,done:true});
  const read=await GET(new Request('http://localhost/api'),{params:Promise.resolve({id})}), b=await read.json();
  assert.ok(b.questions[0].confirmedAt);assert.equal(b.questions[0].responses[1].concern,concern);assert.equal(b.questions[0].responses[1].stance,'agree_with_concerns');
  const snapshot=JSON.parse(b.history.find((e:any)=>e.action==='confirm').detail_json).confirmedSnapshot;
  assert.equal(snapshot.responses[1].concern,concern);
  assert.throws(()=>response(id,qid,people[1].id),/수정할 수/);
 });
 await t.test('consent with concerns requires nonblank concern at API boundary',async()=>{
  const {id,qid,people}=setup();const before=getDecisionBoard(id).revision;
  for(const concern of [undefined,'','   ']){
   const r=await POST(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:before,command:{action:'response',questionId:qid,participantId:people[1].id,stance:'agree_with_concerns',understanding:'실측한다.',concern}})}),{params:Promise.resolve({id})});
   assert.equal(r.status,400);assert.equal(getDecisionBoard(id).revision,before);
  }
 });
 await t.test('proposal change requires renewed consent with concerns and retains old concern in audit',()=>{
  const {id,qid,people}=setup();response(id,qid,people[0].id);
  cmd(id,{action:'response',questionId:qid,participantId:people[1].id,stance:'agree_with_concerns',understanding:'실측부터 한다.',concern:'비용 증가 우려'});
  cmd(id,{action:'proposal',questionId:qid,proposal:'최종 배치를 바로 바꾼다.',ownerId:people[0].id,dueDate:null,criteria:'배치 변경 확인'});
  assert.equal(getDecisionBoard(id).questions[0].responses.length,0);
  assert.throws(()=>cmd(id,{action:'confirm',questionId:qid}),/아직 확인/);
  assert.ok(getDecisionBoard(id).history.some((e:any)=>e.action==='response'&&JSON.parse(e.detail_json).concern==='비용 증가 우려'));
 });
 await t.test('proposal revision clears approvals, current unanimous records confirm',()=>{const {id,qid,people}=setup();people.forEach(p=>response(id,qid,p.id));cmd(id,{action:'proposal',questionId:qid,proposal:'통로 폭과 출입문 폭을 잰다.',ownerId:people[1].id,dueDate:'2026-10-03',criteria:'두 수치를 배치도에 표시'});assert.equal(getDecisionBoard(id).questions[0].responses.length,0);assert.throws(()=>cmd(id,{action:'confirm',questionId:qid}),/아직 확인/);people.forEach(p=>response(id,qid,p.id));cmd(id,{action:'confirm',questionId:qid});assert.ok(getDecisionBoard(id).questions[0].confirmedAt);assert.equal(getDecisionBoard(id).recordMode,'facilitator_recorded_not_identity_verified');});
 await t.test('new participant requires confirmation; historical confirmed roster remains',()=>{const {id,qid,people}=setup();people.forEach(p=>response(id,qid,p.id));cmd(id,{action:'participant',name:'다',role:''});assert.throws(()=>cmd(id,{action:'confirm',questionId:qid}),/다: 아직/);const third=getDecisionBoard(id).participants[2];response(id,qid,third.id);cmd(id,{action:'confirm',questionId:qid});cmd(id,{action:'participant',name:'라',role:''});assert.equal(getDecisionBoard(id).questions[0].participantsAtConfirmation.length,3);});
 await t.test('confirmed proposal immutable; task completion requires confirmation',()=>{const {id,qid,people}=setup();assert.throws(()=>cmd(id,{action:'task',questionId:qid,done:true}),/공동 확인 완료 후/);people.forEach(p=>response(id,qid,p.id));cmd(id,{action:'confirm',questionId:qid});assert.throws(()=>cmd(id,{action:'proposal',questionId:qid,proposal:'수정',ownerId:people[0].id,dueDate:null,criteria:'수정'}),/수정할 수/);cmd(id,{action:'task',questionId:qid,done:true});assert.equal(getDecisionBoard(id).questions[0].task?.done,true);});
 await t.test('foreign participant, foreign question and invalid dates rejected',()=>{const a=setup(),b=setup();assert.throws(()=>response(a.id,a.qid,b.people[0].id),/등록된 참가자/);assert.throws(()=>cmd(a.id,{action:'confirm',questionId:b.qid}),/안건을 찾을/);assert.throws(()=>cmd(a.id,{action:'proposal',questionId:a.qid,proposal:'결정안',ownerId:b.people[0].id,dueDate:null,criteria:'검사'}),/담당자로/);assert.throws(()=>cmd(a.id,{action:'proposal',questionId:a.qid,proposal:'결정안',ownerId:a.people[0].id,dueDate:'2026-02-31',criteria:'검사'}),/올바른 날짜/);});
 await t.test('stale revision is 409 through route and preserves state',async()=>{const id=meeting();cmd(id,{action:'participant',name:'가',role:''});const response=await POST(new Request('http://localhost/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:0,command:{action:'participant',name:'나',role:''}})}),{params:Promise.resolve({id})});assert.equal(response.status,409);assert.equal(getDecisionBoard(id).participants.length,1);const read=await GET(new Request('http://localhost/api'),{params:Promise.resolve({id})});assert.equal(read.status,200);assert.equal((await read.json()).revision,1);});
 await t.test('human feedback persisted with reason and audit record',()=>{const {id,qid}=setup();cmd(id,{action:'feedback',questionId:qid,verdict:'false_alarm',reason:'서로 다른 뜻이 아니라 같은 내용을 보완했다.'});const b=getDecisionBoard(id);assert.equal(b.questions[0].feedback?.verdict,'false_alarm');assert.equal(b.history[0].action,'feedback');assert.match(String(b.history[0].detail_json),/보완했다/);});
 await t.test('changed transcript blocks confirmation against stale evidence',()=>{const {id,qid,people}=setup();people.forEach(p=>response(id,qid,p.id));d.prepare("UPDATE utterances SET text_clean='수정된 다른 발언' WHERE meeting_id=?").run(id);assert.throws(()=>cmd(id,{action:'confirm',questionId:qid}),/근거 원문이 변경/);});
 await t.test('AI candidate imports once with source scope checked',async()=>{
  const id=meeting(),other=meeting(),session='session-import';
  d.prepare("INSERT INTO live_sessions(id,meeting_id,run_id,mode,status,started_at)VALUES(?,?,'synthetic-run','mic','stopped','now')").run(session,id);
  const {createFacilitatorSession}=await import('../lib/facilitator/store');createFacilitatorSession(session,id,{goal:'사무실 통로와 책상 배치를 결정합니다.',intervalMinutes:3});
  const assessed={review:{focus:'on_topic',latestRelation:'on_topic',summary:'합성 검토',findings:[{kind:'meaning_gap',question:'통로의 폭을 확인할까요?',summary:'합성 후보',evidence:[{uid:'U-001',quote:'통로를 넓히고',context:'current',role:'signal'}]}]},notification:null,held:[],policyVersion:'facilitator-v1'};
  const inserted=d.prepare("INSERT INTO facilitator_reviews(session_id,from_ms,to_ms,partial,source_count,result_json,attempts_json,created_at)VALUES(?,0,180000,0,1,?,'[]','now')").run(session,JSON.stringify(assessed));const reviewId=Number(inserted.lastInsertRowid);
  cmd(id,{action:'import',reviewId,findingIndex:0});const rev=getDecisionBoard(id).revision;cmd(id,{action:'import',reviewId,findingIndex:0});assert.equal(getDecisionBoard(id).questions.length,1);assert.equal(getDecisionBoard(id).revision,rev);
  assert.throws(()=>cmd(other,{action:'import',reviewId,findingIndex:0}),/후보를 찾을/);
 });
 await t.test('duplicate names and cross-origin mutation rejected',async()=>{const id=meeting();cmd(id,{action:'participant',name:'가',role:''});assert.throws(()=>cmd(id,{action:'participant',name:'가',role:''}),/같은 이름/);const r=await POST(new Request('http://localhost/api',{method:'POST',headers:{origin:'https://other.test'},body:'{}'}),{params:Promise.resolve({id})});assert.equal(r.status,403);});
 await t.test('comparison expression must come from this question evidence',()=>{
  const {id,qid}=setup();
  assert.throws(()=>cmd(id,{action:'comparison',questionId:qid,expression:'따뜻한',decisionTarget:'조명을 결정한다.'}),/원문 근거/);
  assert.equal(getDecisionBoard(id).questions[0].comparison,undefined);
 });
 function compare(){const a=setup();cmd(a.id,{action:'comparison',questionId:a.qid,expression:'통로',decisionTarget:'통로의 폭과 배치를 결정한다.'});return a;}
 const interpret=(a:ReturnType<typeof setup>,person:number,meaning='사람이 지나는 공간')=>cmd(a.id,{action:'interpretation',questionId:a.qid,participantId:a.people[person].id,meaning,example:'',conditions:'',confirmedByParticipant:true});
 const synthesize=(a:ReturnType<typeof setup>,relation='complementary')=>cmd(a.id,{action:'synthesis',questionId:a.qid,relation,sharedConditions:'통로의 폭과 조명을 함께 확인한다.',remainingDifferences:relation==='choice'||relation==='unresolved'?'동선과 조명 중 무엇을 먼저 할지 확인한다.':''});
 await t.test('missing interpretations cannot be synthesized or confirmed even if everyone agrees',()=>{
  const a=compare();interpret(a,0);a.people.forEach(p=>response(a.id,a.qid,p.id));
  assert.throws(()=>synthesize(a),/모든 참가자/);
  assert.throws(()=>cmd(a.id,{action:'confirm',questionId:a.qid}),/해석이 미확인/);
  assert.equal(getDecisionBoard(a.id).questions[0].comparison?.interpretations[0].conditions,'');
 });
 await t.test('interpretation requires explicit participant confirmation and correct membership',()=>{
  const a=compare(),b=setup();
  for(const confirmedByParticipant of [undefined,false])assert.throws(()=>cmd(a.id,{action:'interpretation',questionId:a.qid,participantId:a.people[0].id,meaning:'뜻',example:'',conditions:'',confirmedByParticipant}));
  assert.throws(()=>cmd(a.id,{action:'interpretation',questionId:a.qid,participantId:b.people[0].id,meaning:'뜻',example:'',conditions:'',confirmedByParticipant:true}),/등록된 참가자/);
  assert.equal(getDecisionBoard(a.id).questions[0].comparison?.interpretations.length,0);
 });
 await t.test('complementary meanings can reach a confirmed decision without becoming identical',async()=>{
  const a=compare();interpret(a,0,'사람이 지나가는 폭');interpret(a,1,'통로를 밝히는 조명');synthesize(a);
  assert.equal(getDecisionBoard(a.id).questions[0].confirmedAt,null);
  a.people.forEach(p=>response(a.id,a.qid,p.id));cmd(a.id,{action:'confirm',questionId:a.qid});
  const r=await GET(new Request('http://localhost/api'),{params:Promise.resolve({id:a.id})}),b=await r.json();
  assert.equal(b.questions[0].comparison.interpretations[0].meaning,'사람이 지나가는 폭');
  assert.equal(b.questions[0].comparison.interpretations[1].meaning,'통로를 밝히는 조명');
  const snapshot=JSON.parse(b.history.find((e:any)=>e.action==='confirm').detail_json).confirmedSnapshot;
  assert.equal(snapshot.comparison.synthesis.relation,'complementary');
  assert.throws(()=>interpret(a,1,'수정'),/수정할 수/);
  assert.throws(()=>synthesize(a,'same'),/수정할 수/);
  assert.throws(()=>cmd(a.id,{action:'comparison',questionId:a.qid,expression:'통로',decisionTarget:'다른 대상'}),/수정할 수/);
 });
 await t.test('unresolved comparison blocks decision; choice retains difference and permits explicit consent',()=>{
  const a=compare();interpret(a,0);interpret(a,1);synthesize(a,'unresolved');a.people.forEach(p=>response(a.id,a.qid,p.id));
  assert.throws(()=>cmd(a.id,{action:'confirm',questionId:a.qid}),/미확인 상태/);
  assert.throws(()=>cmd(a.id,{action:'synthesis',questionId:a.qid,relation:'choice',sharedConditions:'일단 폭을 잰다.',remainingDifferences:' '}),/남은 차이/);
  synthesize(a,'choice');assert.equal(getDecisionBoard(a.id).questions[0].responses.length,0);
  a.people.forEach(p=>response(a.id,a.qid,p.id));cmd(a.id,{action:'confirm',questionId:a.qid});
  assert.match(getDecisionBoard(a.id).questions[0].comparison!.synthesis!.remainingDifferences,/동선과 조명/);
 });
 await t.test('changed meaning resets synthesis and consent; history retains original meaning',()=>{
  const a=compare();interpret(a,0);interpret(a,1);synthesize(a);a.people.forEach(p=>response(a.id,a.qid,p.id));const rev=getDecisionBoard(a.id).questions[0].proposalRevision;
  interpret(a,0,'다른 해석');const b=getDecisionBoard(a.id),q=b.questions[0];
  assert.equal(q.comparison!.synthesis,null);assert.equal(q.responses.length,0);assert.ok(q.proposalRevision>rev);
  assert.ok(b.history.some((e:any)=>e.action==='interpretation'&&JSON.parse(e.detail_json).meaning==='사람이 지나는 공간'));
  assert.throws(()=>cmd(a.id,{action:'confirm',questionId:a.qid}),/아직 확인/);
 });
 await t.test('new participant invalidates open synthesis while confirmed snapshot remains unchanged',()=>{
  const a=compare();interpret(a,0);interpret(a,1);synthesize(a);a.people.forEach(p=>response(a.id,a.qid,p.id));
  cmd(a.id,{action:'participant',name:'추가 참가자',role:''});assert.equal(getDecisionBoard(a.id).questions[0].comparison!.synthesis,null);
  assert.throws(()=>synthesize(a),/모든 참가자/);
  const b=compare();interpret(b,0);interpret(b,1);synthesize(b);b.people.forEach(p=>response(b.id,b.qid,p.id));cmd(b.id,{action:'confirm',questionId:b.qid});
  cmd(b.id,{action:'participant',name:'나중 참가자',role:''});assert.equal(getDecisionBoard(b.id).questions[0].participantsAtConfirmation.length,2);assert.equal(getDecisionBoard(b.id).questions[0].comparison!.synthesis!.relation,'complementary');
 });
 await t.test('changing comparison target clears interpretations and blocks stale writes',()=>{
  const a=compare();interpret(a,0);interpret(a,1);synthesize(a);const revision=getDecisionBoard(a.id).revision;
  cmd(a.id,{action:'comparison',questionId:a.qid,expression:'넓히고',decisionTarget:'넓히는 방법을 결정한다.'});
  const q=getDecisionBoard(a.id).questions[0];assert.equal(q.comparison!.interpretations.length,0);assert.equal(q.comparison!.synthesis,null);
  assert.throws(()=>changeDecisionBoard(a.id,revision,{action:'interpretation',questionId:a.qid,participantId:a.people[0].id,meaning:'뜻',example:'',conditions:'',confirmedByParticipant:true}),/다른 변경/);
 });
 }finally{rmSync(dir,{recursive:true,force:true});}
});
