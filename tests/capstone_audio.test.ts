import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { splitAudio } from "../lib/audio/ffmpeg";
import { transcribeLong } from "../lib/transcription/long";

test("30분 25MB 초과 WAV: 실제 ffmpeg 분할, 2개 동시 Opus 전사 응답 병합 및 타임스탬프", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capstone-audio-"));
  const fetchBefore = globalThis.fetch;
  const key = process.env.OPENROUTER_API_KEY, xai = process.env.XAI_API_KEY;
  try {
    process.env.OPENROUTER_API_KEY = "test-only"; delete process.env.XAI_API_KEY;
    const file = path.join(dir, "long.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "1801", "-ac", "1", file]);
    assert.ok(statSync(file).size > 25 * 1024 * 1024);
    const chunks = await splitAudio(file, path.join(dir, "split"), 180000, 3000);
    assert.equal(chunks.length, 11);
    assert.ok(chunks.every(c => statSync(c.file).size < 24 * 1024 * 1024));
    let calls = 0, active = 0, peak = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (!String(url).includes("audio/transcriptions")) throw new Error("sidecar offline");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.input_audio.format, "ogg");
      assert.equal(Buffer.from(body.input_audio.data, "base64").subarray(0, 4).toString(), "OggS");
      active++; peak = Math.max(peak, active); assert.ok(active <= 2);
      await new Promise(r => setTimeout(r, 100)); active--;
      calls++;
      return Response.json({ text: `조각 ${calls}`, words: [{ word: `조각${calls}`, start: 2, end: 2.5, speaker: 0 }] });
    }) as typeof fetch;
    const dataBefore = process.env.SCENENOTE_DATA_DIR;
    process.env.SCENENOTE_DATA_DIR = dir;
    let result;
    try { result = await transcribeLong(file); }
    finally { if (dataBefore === undefined) delete process.env.SCENENOTE_DATA_DIR; else process.env.SCENENOTE_DATA_DIR = dataBefore; }
    assert.equal(peak, 2);
    assert.equal(result.method, "chunked"); assert.equal(calls, 61);
    assert.equal(result.words?.length, 61); assert.equal(result.words?.[1].startMs, 29000);
    assert.equal(result.diarizationStatus, "unsupported");
    assert.equal(result.speakerCount, null);
    assert.ok(result.utterances.every(u => u.speakerId === null), "조각 화자를 전체 회의의 사람으로 표시하지 않음");
    assert.equal(result.text.split(" ").length, 61);
  } finally {
    globalThis.fetch = fetchBefore;
    if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key;
    if (xai === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = xai;
    rmSync(dir, { recursive: true, force: true });
  }
});
test("잘못된 분할 인자는 즉시 거부", async () => {
  await assert.rejects(splitAudio("missing.wav", "/tmp/unused", 0));
  await assert.rejects(splitAudio("missing.wav", "/tmp/unused", 1000, 1000));
});

import { createAudioJob, processAudioBatch, readJob, jobProgress, finishAudioJob } from "../lib/transcription/long";
import { OpenRouterTranscriptionProvider } from "../lib/transcription/providers/openrouter";
import { TranscriptionError } from "../lib/transcription/types";
import { AUDIO_POLICY } from "../lib/transcription/policy";
test("타임아웃 2회 재시도·4xx 즉시 실패·성공 조각 디스크 보존과 재개 (합성 음원·실패 주입)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capstone-retry-"));
  const original = OpenRouterTranscriptionProvider.prototype.transcribe, env = process.env.SCENENOTE_DATA_DIR;
  process.env.SCENENOTE_DATA_DIR = dir;
  const calls = new Map<string, number>(); let recover = false;
  try {
    const file = path.join(dir, "sample.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "91", file]);
    OpenRouterTranscriptionProvider.prototype.transcribe = async input => {
      const key = input.fileName, n = (calls.get(key) ?? 0) + 1; calls.set(key, n);
      if (!recover && key === "1.ogg") throw new TranscriptionError("TIMEOUT", "주입한 타임아웃");
      if (!recover && key === "2.ogg") throw new TranscriptionError("TRANSCRIPTION_FAILED", "주입한 400", {status: 400});
      if (key === "3.ogg" && n === 1) throw new TranscriptionError("TRANSCRIPTION_FAILED", "주입한 503", {status: 503});
      return {provider: "openrouter", model: "failure-injection", language: "ko", text: "검증", utterances: [], diarizationStatus: "unsupported", speakerCount: null,
        durationMs: 1000, sourceFileName: key, words: [{text:"검증", startMs: 500, endMs: 800, speaker: null}]};
    };
    const job = await createAudioJob(file, "test");
    assert.ok(job.chunks.every(c => c.durationMs <= AUDIO_POLICY.providerTimeoutMs));
    await processAudioBatch(job); await processAudioBatch(readJob(job.id));
    const progress = jobProgress(readJob(job.id));
    assert.equal(progress.completedChunks, 2); assert.equal(progress.pendingChunks, 0);
    assert.deepEqual(progress.failedChunks.map(c => [c.index, c.attempts]), [[1,3],[2,1]]);
    assert.equal(calls.get("3.ogg"), 2);
    await assert.rejects(finishAudioJob(job), (e: unknown) => e instanceof TranscriptionError && (e.detail as typeof progress).failedChunks.length === 2);
    recover = true; await processAudioBatch(readJob(job.id), true);
    assert.equal(jobProgress(readJob(job.id)).completedChunks, 4);
    assert.equal(calls.get("0.ogg"), 1, "성공한 첫 조각을 다시 전송하지 않음");
    assert.equal(calls.get("3.ogg"), 2, "성공한 마지막 조각을 다시 전송하지 않음");
    assert.equal(jobProgress(job).failedChunks.length, 0);
    assert.throws(() => readJob(job.id, "other-meeting"));
    await assert.rejects(createAudioJob(file, "test", {chunkMs: 60000, overlapMs: 3000}));
  } finally {
    OpenRouterTranscriptionProvider.prototype.transcribe = original;
    if (env === undefined) delete process.env.SCENENOTE_DATA_DIR; else process.env.SCENENOTE_DATA_DIR = env;
    rmSync(dir, {recursive:true,force:true});
  }
});

test("duration 헤더 없는 MediaRecorder 형식 WebM도 실제 패킷 길이로 분할 가능 (합성)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "capstone-webm-"));
  try {
    const file = path.join(dir, "unfinished.webm");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-c:a", "libopus", "-live", "1", file]);
    const header = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).toString().trim();
    assert.equal(header, "N/A");
    const { probeDurationMs } = await import("../lib/audio/ffmpeg");
    assert.ok(Math.abs(await probeDurationMs(file) - 4000) < 100);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
