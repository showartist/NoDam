import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { previewText } from "../lib/meetingIntake/model";

test("v2 intake runtime — synthetic input, no external API", async t => {
  const dir=mkdtempSync(path.join(tmpdir(),"nodam-intake-"));process.env.SCENENOTE_DB=path.join(dir,"test.db");
  const {db}=await import("../lib/db");
  const {createIntake,getIntakeMetadata}=await import("../lib/meetingIntake/store");
  const {getMeetingUtterances,getCurrentRun,listRuns}=await import("../lib/alignment/store");
  const {getMeetingContext,runBatchAnalysis}=await import("../lib/alignment/analyze");
  const {POST}=await import("../app/api/meetings/intake/route");
  const d=db();
  const input=(overrides:Record<string,unknown>={})=>({requestId:randomUUID(),title:"합성 회의",purpose:"따뜻함의 뜻과 제작 조건 확인",kind:"discussion",mode:"text",sourceType:"actual",text:"민지: 따뜻한 식탁\n준호: 빈 부엌",...overrides});
  const counts=()=>["projects","meetings","utterances","meeting_intake"].map(table=>(d.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n);
  const originalFetch=globalThis.fetch;const originalKey=process.env.OPENROUTER_API_KEY;
  try {
    await t.test("plain text, Markdown and unlabelled continuation are preserved without inventing identity",()=>{
      const value="# 제목\n이름 없는 첫 문장\n민지: 따뜻해요\n다음 줄은 화자를 모릅니다.\n준호: 동의해요";
      const p=previewText(value);assert.equal(p.turns.length,5);assert.deepEqual(p.turns.map(t=>t.speaker),[null,null,"민지",null,"준호"]);assert.ok(p.turns.every(t=>t.startMs===null&&t.endMs===null));
      const r=createIntake(input({text:value}));assert.equal((d.prepare("SELECT raw_transcript FROM meetings WHERE id=?").get(r.meetingId) as {raw_transcript:string}).raw_transcript,value);
      assert.equal(getMeetingUtterances(r.meetingId)[0].speakerKey,null);
    });
    await t.test("explicit times preserved; unsupported timestamps remain source, not invented speakers",()=>{
      const r=createIntake(input({text:"00:12 민지: 첫 발언\n다음 발언\n01:02:03 준호: 긴 시간\n00:99 민지: 잘못된 시간"}));
      const turns=getMeetingUtterances(r.meetingId);assert.equal(turns[0].startMs,12000);assert.equal(turns[0].endMs,null);assert.equal(turns[1].startMs,null);assert.equal(turns[2].speakerKey,null);assert.match(turns[2].text,/01:02:03/);assert.equal(turns[3].startMs,null);
    });
    await t.test("invalid inputs and missing projects create no partial rows",async()=>{
      for(const bad of [{title:" "},{purpose:""},{mode:"text",text:""},{projectId:"not-found"},{mode:"audio",sourceType:"fictional",text:""}]){const before=counts();const r=await POST(new Request("http://local/intake",{method:"POST",body:JSON.stringify(input(bad))}));assert.ok(r.status>=400);assert.deepEqual(counts(),before);}
      const r=await POST(new Request("http://local/intake",{method:"POST",body:"{"}));assert.equal(r.status,400);
    });
    await t.test("a failing utterance insert rolls back project, meeting and metadata",()=>{
      d.exec("CREATE TRIGGER intake_test_fail BEFORE INSERT ON utterances WHEN NEW.text_clean='trigger failure' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;");
      const before=counts();assert.throws(()=>createIntake(input({text:"가: trigger failure"})),/synthetic storage failure/);assert.deepEqual(counts(),before);d.exec("DROP TRIGGER intake_test_fail");
    });
    await t.test("same request retries reuse the saved meeting; changed retry returns 409",async()=>{
      const value=input();const a=createIntake(value),before=counts(),b=createIntake(value);assert.equal(b.meetingId,a.meetingId);assert.equal(b.reused,true);assert.deepEqual(counts(),before);
      const r=await POST(new Request("http://local/intake",{method:"POST",body:JSON.stringify({...value,title:"変更"})}));assert.equal(r.status,409);assert.deepEqual(counts(),before);
    });
    await t.test("existing project is preserved; meeting-specific purpose does not reuse prior context",()=>{
      const a=createIntake(input());d.prepare("UPDATE projects SET one_line='以前の秘密の目的' WHERE id=?").run(a.projectId);
      const b=createIntake(input({projectId:a.projectId,purpose:"이번 회의 목적",kind:"brainstorm"}));assert.equal(b.projectId,a.projectId);assert.equal((d.prepare("SELECT one_line FROM projects WHERE id=?").get(a.projectId) as {one_line:string}).one_line,"以前の秘密の目的");
      const context=getMeetingContext(b.meetingId);assert.match(context.sceneLine!,/이번 회의 목적/);assert.doesNotMatch(context.sceneLine!,/以前/);assert.match(context.sceneLine!,/아이디어의 다양성/);
    });
    await t.test("live and audio start empty without model calls or participants",()=>{
      globalThis.fetch=async()=>{throw new Error("network must not be called");};
      for(const mode of ["live","audio"]){const r=createIntake(input({mode,text:""}));assert.equal(r.utteranceCount,0);assert.equal(getIntakeMetadata(r.meetingId)?.input_mode,mode);assert.equal(getCurrentRun(r.meetingId),null);}
    });
    await t.test("practice input cannot become a real decision through either confirmation path",async()=>{
      const {changeDecisionBoard}=await import("../lib/meetingDecisions/store");const {resolveIssue}=await import("../lib/alignment/resolution");
      for(const sourceType of ["fictional","planned"]){const r=createIntake(input({sourceType}));assert.equal(getIntakeMetadata(r.meetingId)?.source_type,sourceType);assert.throws(()=>changeDecisionBoard(r.meetingId,0,{action:"confirm",questionId:"any"}),/가상·예정/);assert.throws(()=>resolveIssue({meetingId:r.meetingId,projectId:r.projectId,runId:"r",issueId:"i",selected:[],summary:"합의",resolvedBy:"진행자"}),/가상·예정/);}
      assert.equal((d.prepare("SELECT COUNT(*) n FROM decision_ledger").get() as {n:number}).n,0);
    });
    await t.test("analysis failure keeps raw text and leaves a failed run for retry",async()=>{
      delete process.env.OPENROUTER_API_KEY;
      const r=createIntake(input()),before=counts();await assert.rejects(()=>runBatchAnalysis(r.meetingId,{contextCheck:false}),/OPENROUTER|설정|키/);assert.deepEqual(counts(),before);assert.equal(listRuns(r.meetingId)[0]?.status,"failed");assert.equal(getMeetingUtterances(r.meetingId).length,2);
    });
    await t.test("mocked model output cannot label practice agreement as actual; old context stays out",async()=>{
      process.env.OPENROUTER_API_KEY="synthetic-test-value-not-a-credential";let requests=0;let submitted="";
      globalThis.fetch=async(_url,opts)=>{requests++;submitted=String(opts?.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({issues:[],agreements:[{topic:"컨셉",summary:"따뜻한 광고",evidence:["U01","U02"]}]})}}],usage:{prompt_tokens:1,completion_tokens:1}}),{status:200});};
      const m=createIntake(input({sourceType:"fictional"}));const r=await runBatchAnalysis(m.meetingId,{contextCheck:false});assert.equal(requests,1);assert.match(submitted,/가상/);assert.deepEqual(r.agreements,[]);assert.match(JSON.stringify(r.stats.consistency),/자동으로 가져오지/);
    });
  } finally {globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=originalKey;d.close();rmSync(dir,{recursive:true,force:true});}
});
