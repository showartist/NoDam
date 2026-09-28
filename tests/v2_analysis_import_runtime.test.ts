import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
test("v2 analysis to clarification — synthetic stored output, no model call",async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),"nodam-import-"));process.env.SCENENOTE_DB=path.join(dir,"test.db");
 const {db}=await import("../lib/db");const {createIntake}=await import("../lib/meetingIntake/store");
 const {createRun,finishRun,saveIssues}=await import("../lib/alignment/store");
 const {getDecisionBoard,changeDecisionBoard}=await import("../lib/meetingDecisions/store");
 const {POST}=await import("../app/api/meetings/[id]/analyze-v2/route");
 const d=db();
 const meeting=()=>createIntake({requestId:randomUUID(),title:"합성 검증",purpose:"출시 범위를 함께 확인",kind:"decision",mode:"text",sourceType:"actual",text:"민지: 빠른 출시는 기능을 줄이자는 뜻입니다.\n준호: 빠른 출시는 사람을 늘리자는 뜻입니다."}).meetingId;
 const setup=()=>{const id=meeting(),runId=createRun(id,"batch","synthetic-no-call");saveIssues(runId,[{
  schema:"scenenote.alignment/2",issue_id:"A-01",key:"launch",meeting_id:id,analysis_run_id:runId,data_mode:"fixture",window:null,type:"interpretation_gap",decision:"출시 범위",concept:"빠른 출시",state:"open",condition:null,
  positions:[{speaker:{key:"N:민지",name:"민지",role:null},meaning:"기능 축소",quote:"빠른 출시는 기능을 줄이자는 뜻입니다.",evidence:["U01"],slots:{},checks:{speaker:"ok",quote:"ok",context:"supported",contextNote:"합성"}},{speaker:{key:"N:준호",name:"준호",role:null},meaning:"인력 추가",quote:"빠른 출시는 사람을 늘리자는 뜻입니다.",evidence:["U02"],slots:{},checks:{speaker:"ok",quote:"ok",context:"supported",contextNote:"합성"}}],
  slot_diff:[],distance:{differs:0,compared:0,value:null,basis:"수치 없음"},question:"빠른 출시가 기능 축소인가요 인력 추가인가요?",why_it_matters:"범위",severity:"high",role_briefs:{},evidence_all:["U01","U02"],dropped:[],audit:[],past_decisions:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()
 }]);finishRun(runId,{status:"completed"});return{id,runId};};
 const take=(id:string,runId:string)=>changeDecisionBoard(id,getDecisionBoard(id).revision,{action:"import_analysis",runId,issueId:"A-01"});
 try{
 await t.test("imports both exact quotes once; never invents participants or consent",()=>{const {id,runId}=setup();let b=take(id,runId);assert.equal(b.questions.length,1);assert.equal(b.questions[0].evidence.length,2);assert.equal(b.questions[0].analysisSource?.runId,runId);assert.equal(b.participants.length,0);assert.equal(b.questions[0].confirmedAt,null);assert.equal(b.questions[0].responses.length,0);assert.equal(b.questions[0].comparison?.expression,"빠른 출시");assert.deepEqual(b.questions[0].comparison?.interpretations,[]);assert.match(b.goal!,/출시 범위/);const rev=b.revision;b=take(id,runId);assert.equal(b.revision,rev);assert.equal(b.questions.length,1);});
 await t.test("rejects a run from another meeting",()=>{const a=setup(),other=meeting();assert.throws(()=>take(other,a.runId),/이 회의의 분석/);assert.equal(getDecisionBoard(other).questions.length,0);});
 await t.test("changed source quote cannot be imported",()=>{const a=setup();d.prepare("UPDATE utterances SET text_clean='변경된 원문' WHERE meeting_id=? AND uid='U01'").run(a.id);assert.throws(()=>take(a.id,a.runId),/현재 원문/);assert.equal(getDecisionBoard(a.id).revision,0);});
 await t.test("speaker-only edit blocks importing or confirming the old analysis",async()=>{const a=setup(),b=take(a.id,a.runId);const {editUtterance}=await import("../lib/meetingIntake/edit");editUtterance(a.id,{uid:"U01",text:"빠른 출시는 기능을 줄이자는 뜻입니다.",speakerName:"다른 화자",expectedText:"빠른 출시는 기능을 줄이자는 뜻입니다.",expectedSpeakerName:"민지"});assert.throws(()=>take(a.id,a.runId),/발언 또는 화자/);assert.throws(()=>changeDecisionBoard(a.id,b.revision,{action:"confirm",questionId:b.questions[0].id}),/발언·화자가 수정/);assert.equal(getDecisionBoard(a.id).questions[0].confirmedAt,null);});
 await t.test("running or superseded analyses cannot create confirmation questions",()=>{const a=setup();const newer=createRun(a.id,"batch","synthetic");d.prepare("UPDATE alignment_v2_runs SET created_at='2099-01-01' WHERE id=?").run(newer);assert.throws(()=>take(a.id,newer),/현재 완료/);finishRun(newer,{status:"completed"});assert.throws(()=>take(a.id,a.runId),/현재 완료/);});
 await t.test("batch API rejects duplicate work; active recording supports an immutable analysis snapshot",async()=>{const a=setup();createRun(a.id,"batch","synthetic");let r=await POST(new Request("http://local",{method:"POST",body:"{}"}),{params:Promise.resolve({id:a.id})});assert.equal(r.status,409);assert.match((await r.json()).error,/이미 전체 분석/);
 const id=meeting(),liveRun=createRun(id,'live','synthetic');d.prepare("INSERT INTO live_sessions(id,meeting_id,run_id,mode,status,started_at)VALUES('synthetic-live',?,?,'mic','recording','now')").run(id,liveRun);const oldFetch=globalThis.fetch,oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY="synthetic";
 try{let submitted="";globalThis.fetch=async(url,opts)=>{if(String(url).includes("/endpoints"))return Response.json({data:{endpoints:[{supported_parameters:["structured_outputs","max_tokens"]}]}});submitted=String(opts?.body);d.prepare("INSERT INTO utterances(id,meeting_id,idx,uid,text_clean,text_raw,created_at) VALUES(?,?,2,'U03','나중 발언','나중 발언','now')").run(randomUUID(),id);return Response.json({choices:[{message:{content:JSON.stringify({issues:[],agreements:[]})}}],usage:{prompt_tokens:1,completion_tokens:1}});};
 r=await POST(new Request("http://local",{method:"POST",body:'{"contextCheck":false}'}),{params:Promise.resolve({id})});assert.equal(r.status,200);const result=await r.json();assert.doesNotMatch(submitted,/나중 발언/);const snapshot=d.prepare("SELECT source_count,through_uid,source_json FROM analysis_jobs WHERE run_id=?").get(result.runId) as any;assert.equal(snapshot.source_count,2);assert.equal(snapshot.through_uid,"U02");assert.doesNotMatch(snapshot.source_json,/나중 발언/);assert.equal((d.prepare("SELECT status FROM live_sessions WHERE meeting_id=?").get(id) as any).status,"recording");
 }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;}});
 }finally{d.close();rmSync(dir,{recursive:true,force:true});}
});
