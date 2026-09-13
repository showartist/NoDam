/** 실제 라우트 함수→multipart stream→ffmpeg→공급자 HTTP 경계→DB 배선.
 * 음원은 합성, 공급자 응답은 명시적 실패 주입이다. 실제 API 품질 증거와 별도로 실행한다. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("업로드 라우트는 202 배치→실패 조각 보존→재시도→완료 후에만 원문 교체", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "review-upload-"));
  const env = {...process.env}, oldFetch = globalThis.fetch;
  process.env.SCENENOTE_DB = path.join(dir, "test.db"); process.env.SCENENOTE_DATA_DIR = dir; process.env.OPENROUTER_API_KEY = "injected-test";
  try {
    const { POST } = await import("../app/api/meetings/[id]/audio-transcribe/route");
    const { db } = await import("../lib/db");
    const { replaceMeetingTranscript } = await import("../lib/transcription/save");
    db().prepare("INSERT INTO projects (id,title,domain,created_at) VALUES ('p-runtime','합성 검사','film','now')").run();
    db().prepare("INSERT INTO meetings (id,project_id,title,raw_transcript,created_at) VALUES ('runtime','p-runtime','합성 검사','','now')").run();
    replaceMeetingTranscript("runtime", {provider:"openrouter", model:"original-test", language:"ko", text:"원문 보존", utterances:[{text:"원문 보존",speakerId:null,speakerName:null,startMs:0,endMs:1000,confidence:null}], diarizationStatus:"unsupported",speakerCount:null,durationMs:1000,sourceFileName:"original.wav"}, "test");
    const original = () => db().prepare("SELECT text_raw FROM utterances WHERE meeting_id='runtime' ORDER BY idx").all();
    const before = original();
    const file = path.join(dir, "61s.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "61", file]);
    const fd = new FormData(); fd.append("file", new File([readFileSync(file)], "61s.wav", {type:"audio/wav"}));
    const req = new Request("http://localhost/api/meetings/runtime/audio-transcribe", {method:"POST",body:fd});
    req.formData = async () => { throw new Error("전체 formData 적재 금지"); };
    const props = {params:Promise.resolve({id:"runtime"})};
    const uploaded = await POST(req, props); assert.equal(uploaded.status, 202);
    const {jobId} = await uploaded.json(); assert.ok(jobId); assert.deepEqual(original(), before);
    let fail = true, calls = 0;
    globalThis.fetch = (async (url: string | Request | URL, init?:RequestInit) => {
      if (!String(url).includes("audio/transcriptions")) throw new Error("테스트 사이드카 없음");
      calls++;
      const body = JSON.parse(String(init?.body)); assert.equal(body.input_audio.format, "ogg");
      if (fail) return Response.json({error:{message:"주입한 인증 실패"}}, {status:401});
      return Response.json({text:"합성 검사",words:[{word:"합성 검사",start:2,end:2.5,speaker:0}]});
    }) as typeof fetch;
    const step = (retryFailed = false) => POST(new Request("http://localhost/api/meetings/runtime/audio-transcribe", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId,retryFailed})}), props);
    assert.equal((await step()).status, 202); assert.equal(calls, 2);
    assert.equal((await step()).status, 202); assert.equal(calls, 3);
    const failed = await step(), j = await failed.json(); assert.equal(failed.status,502); assert.equal(j.failedChunks.length,3); assert.equal(j.code,"PARTIAL_TRANSCRIPTION");
    assert.deepEqual(original(), before);
    fail = false; assert.equal((await step(true)).status,202); assert.equal((await step()).status,202);
    const done = await step(), result = await done.json(); assert.equal(done.status,200); assert.equal(result.utteranceCount,3); assert.equal(result.chunkCount,3);
    assert.notDeepEqual(original(),before); assert.equal(calls,6);
    const repeated = await (await step()).json(); assert.equal(repeated.runId,result.runId); assert.equal(calls,6);
    const { GET } = await import("../app/api/meetings/[id]/analyze-v2/route");
    const review = await (await GET(new Request("http://localhost/api/meetings/runtime/analyze-v2"),props)).json();
    assert.ok(!("index" in review));
    console.log(`runtime: chunks=3, attempts=6, preserved-on-failure=true, idempotent-run=${repeated.runId===result.runId}`);
    db().close();
  } finally { globalThis.fetch = oldFetch; process.env = env; rmSync(dir,{recursive:true,force:true}); }
});
