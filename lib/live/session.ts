/**
 * 라이브 세션 엔진 (계획서 2-3: 준실시간 입력).
 *
 *   조각 도착 → 16kHz WAV 변환 → STT(OpenRouter Grok) → 조각 사이 화자 번호 잇기(사이드카 임베딩)
 *   → 회의 발언으로 이어 붙이기 → 새 발언이 windowSize 개 쌓이면 창 단위 분석 → 안건 저장·방송
 *
 * - 조각은 도착 순서대로 하나씩 처리한다(발언 번호가 섞이지 않게).
 * - 창 분석은 한 번에 하나만 돈다. 도는 동안 쌓인 발언은 다음 창으로 넘긴다.
 * - 회의 중 발언과 안건은 "잠정"이다. 정지하면 남은 발언을 마지막 창으로 분석하고, 전체 녹음을 한 파일로 남긴다.
 *   전체 녹음으로 다시 전사·분석하는 것은 사람이 고르는 다음 단계다(finalize).
 * - 엔진 상태는 서버 메모리에 있다. 서버가 다시 뜨면 진행 중인 세션은 멈춘 것으로 본다(발언·안건은 DB 에 남아 있다).
 */
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { advanceFacilitator, createFacilitatorSession, getFacilitatorState, recordAudioGap } from "../facilitator/store";
import { FACILITATOR_MODEL } from "../facilitator/analyze";
import type { Config } from "../facilitator/policy";
import { db, now, uid } from "../db";
import { OpenRouterTranscriptionProvider, TranscriptionError, type TranscriptResult } from "../transcription";
import { probeDurationMs, toWav16k, toOpus } from "../audio/ffmpeg";
import { AUDIO_POLICY } from "../transcription/policy";
import { linkChunk, type Registry } from "../audio/speakerLink";
import { withSidecarSpeakers } from "../transcription/withSpeakers";
import { createRun, finishRun, getMeetingUtterances, upsertIssue } from "../alignment/store";
import { DEFAULT_WINDOW_MODEL, newWindowState, runWindow, type WindowState } from "../alignment/window";
import { getMeetingContext } from "../alignment/analyze";
import { publish } from "./bus";
import {segmentDatabase,segmentBase,saveSegment,speakerChunkIndex} from "./segments";

export const LIVE_DIR = path.join(process.cwd(), ".data", "live");

type Engine = {
  facilitator?: Config;
  mediaEndMs: number;
  acceptedOffsets: Map<number, string>;
  sessionId: string;
  meetingId: string;
  runId: string;
  mode: "mic" | "replay";
  windowSize: number;
  state: WindowState;
  registry: Registry;
  analyzedUpTo: number;
  chunkIdx: number;
  queue: Promise<void>;
  windowRunning: boolean;
  windowAgain: boolean;
  stopping: boolean;
  linkMethod: string | null;
  chunkFiles: string[];
  abort: AbortController;
};

const g = globalThis as unknown as { __scenenoteLive?: Map<string, Engine> };
const engines: Map<string, Engine> = (g.__scenenoteLive ??= new Map());

export class LiveError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NOT_EMPTY" | "ALREADY_RUNNING" | "STOPPED" | "BAD_CHUNK" | "PENDING_CHUNKS",
    message: string,
  ) {
    super(message);
    this.name = "LiveError";
  }
}

export function getEngine(sessionId: string): Engine | null {
  return engines.get(sessionId) ?? null;
}

export function activeSessionFor(meetingId: string): Engine | null {
  for (const e of engines.values()) if (e.meetingId === meetingId && !e.stopping) return e;
  return null;
}

export function startSession(meetingId: string, mode: "mic" | "replay", opts: { source?: string; speed?: number; windowSize?: number; facilitator?: Config; continueMeeting?: boolean } = {}): Engine {
  if (activeSessionFor(meetingId)) throw new LiveError("ALREADY_RUNNING", "이 회의에서 이미 라이브 세션이 돌고 있습니다.");
  const prior=db().prepare("SELECT id,status,registry_json FROM live_sessions WHERE meeting_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1").get(meetingId) as {id:string;status:string;registry_json:string}|undefined;
  if(prior&&["recording","stopping"].includes(prior.status))throw new LiveError("ALREADY_RUNNING","저장된 세션의 녹음 또는 종료 처리를 먼저 복구해 주세요.");
  const continuation=opts.continueMeeting===true;
  if(continuation&&(!prior||prior.status!=="stopped"||mode!=="mic"||!opts.facilitator))throw new LiveError("NOT_EMPTY","완료된 마이크 회의에서만 새 구간을 이어갈 수 있습니다.");
  if(continuation&&db().prepare("SELECT r.id FROM alignment_v2_runs r JOIN live_sessions l ON l.run_id=r.id WHERE l.id=? AND r.status!='completed'").get(prior!.id))throw new LiveError("STOPPED","이전 구간의 종료 처리를 먼저 마쳐 주세요.");
  if (!continuation&&getMeetingUtterances(meetingId).length > 0) {
    throw new LiveError("NOT_EMPTY", "발언이 이미 있는 회의입니다. 라이브 입력은 빈 회의에서 시작합니다(새 라이브 회의를 만드세요).");
  }
  const baseMs=continuation?Math.max(0,...getMeetingUtterances(meetingId).map(u=>u.endMs??u.startMs??0),...((db().prepare("SELECT offset_ms+COALESCE(duration_ms,0) end_ms FROM live_chunks WHERE session_id IN (SELECT id FROM live_sessions WHERE meeting_id=?)").all(meetingId) as {end_ms:number}[]).map(c=>c.end_ms))):0;
  const sessionId = `live_${uid()}`;
  const runId = createRun(meetingId, "live", opts.facilitator ? FACILITATOR_MODEL : DEFAULT_WINDOW_MODEL, { judgeModel: "anthropic/claude-haiku-4.5" });
  db()
    .prepare(`INSERT INTO live_sessions (id, meeting_id, run_id, mode, source, speed, status, started_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(sessionId, meetingId, runId, mode, opts.source ?? null, opts.speed ?? null, "recording", now());
  segmentDatabase().prepare("INSERT INTO live_segments(session_id,base_ms) VALUES(?,?)").run(sessionId,baseMs);
  if(opts.facilitator){createFacilitatorSession(sessionId, meetingId, opts.facilitator);db().prepare("UPDATE facilitator_sessions SET processed_ms=? WHERE session_id=?").run(baseMs,sessionId);}
  const e: Engine = {
    facilitator: opts.facilitator,
    mediaEndMs: baseMs,
    acceptedOffsets: new Map(),
    sessionId,
    meetingId,
    runId,
    mode,
    windowSize: opts.windowSize ?? Number(process.env.SCENENOTE_LIVE_WINDOW ?? 12),
    state: newWindowState(meetingId, runId),
    registry: continuation?JSON.parse(prior!.registry_json):[],
    analyzedUpTo: 0,
    chunkIdx: 0,
    queue: Promise.resolve(),
    windowRunning: false,
    windowAgain: false,
    stopping: false,
    linkMethod: null,
    chunkFiles: [],
    abort: new AbortController(),
  };
  engines.set(sessionId, e);
  mkdirSync(path.join(LIVE_DIR, sessionId), { recursive: true });
  publish(meetingId, { type: "session", sessionId, status: "recording", mode });
  return e;
}

const pad = (n: number) => String(n).padStart(3, "0");
const msToClock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** 조각 하나를 큐에 넣는다. 처리는 도착 순서대로 한다. */
export function ingestChunk(sessionId: string, input: { bytes: Buffer; ext: string; offsetMs: number }): Promise<void> {
  const e = engines.get(sessionId);
  if (!e) throw new LiveError("NOT_FOUND", "라이브 세션을 찾을 수 없습니다(서버가 다시 떴을 수 있습니다).");
  if (e.stopping) throw new LiveError("STOPPED", "이미 정지한 세션입니다.");
  if(!Number.isFinite(input.offsetMs) || input.offsetMs<0 || input.bytes.length>8*1024*1024 || !/^(webm|m4a|mp4|ogg|wav)$/.test(input.ext)) throw new LiveError("BAD_CHUNK","잘못된 녹음 조각입니다.");
  if(input.offsetMs<segmentBase(sessionId))throw new LiveError("BAD_CHUNK","이전 구간보다 앞선 시각의 녹음입니다.");
  const digest=createHash("sha256").update(input.bytes).digest("hex");
  const previous=e.acceptedOffsets.get(input.offsetMs);
  if(previous){if(previous!==digest)throw new LiveError("BAD_CHUNK","같은 시각의 서로 다른 녹음 조각입니다.");return e.queue;}
  if([...e.acceptedOffsets.keys()].some(offset=>offset>input.offsetMs))throw new LiveError("BAD_CHUNK","녹음 조각 순서가 바뀌었습니다. 먼저 실패한 조각을 재전송하세요.");
  const idx = e.chunkIdx++;
  const dir = path.join(LIVE_DIR, sessionId);
  const raw = path.join(dir, `raw_${pad(idx)}.${input.ext || "webm"}`);
  writeFileSync(raw, input.bytes);
  db().prepare(`INSERT INTO live_chunks(session_id,idx,offset_ms,file_path,status,created_at) VALUES(?,?,?,?,?,?)`).run(sessionId,idx,input.offsetMs,raw,"queued",now());
  e.acceptedOffsets.set(input.offsetMs,digest);
  publish(e.meetingId,{type:"chunk",sessionId,idx,offsetMs:input.offsetMs,sttMs:null,utterances:0,linkMethod:"pending",status:"queued"});
  e.queue = e.queue.then(() => {
    const failed=db().prepare("SELECT COUNT(*) n FROM live_chunks WHERE session_id=? AND idx<? AND status!='done'").get(sessionId,idx) as {n:number};
    if(!failed.n)return processChunk(e,idx,raw,input.offsetMs);
  }).catch(() => {});
  return e.queue;
}

async function processChunk(e: Engine, idx: number, raw: string, offsetMs: number): Promise<void> {
  const saved=db().prepare("SELECT status FROM live_chunks WHERE session_id=? AND idx=?").get(e.sessionId,idx) as {status:string}|undefined;
  if(saved?.status==="done")return;
  // 입력이 이미 WAV 일 수 있으므로(재생 모드) 변환본은 다른 이름으로 쓴다.
  const wav = path.join(path.dirname(raw), `pcm_${pad(idx)}.wav`);
  let sttMs: number | null = null;
  let durationMs: number | null = null;
  try {
    await toWav16k(raw, wav);
    durationMs = await probeDurationMs(wav);
    if(!durationMs||durationMs>31_000)throw new LiveError("BAD_CHUNK","실시간 녹음 조각은 31초 이하여야 합니다.");
    e.chunkFiles.push(wav);
    if(e.facilitator)recordAudioGap(e.sessionId,e.mediaEndMs,offsetMs);
    e.mediaEndMs=Math.max(e.mediaEndMs,offsetMs+(durationMs??0));
    publish(e.meetingId, { type: "status", stage: "stt", label: "음성 인식 중" });

    const t0 = Date.now();
    let result: TranscriptResult | null = null;
    const ogg=path.join(path.dirname(raw),`upload_${pad(idx)}.ogg`);
    await toOpus(wav,ogg,AUDIO_POLICY.encodeTimeoutMs);
    const b=readFileSync(ogg),audio=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;
    for(let attempt=0;;attempt++){
      try {result=await new OpenRouterTranscriptionProvider().transcribe({audio,fileName:`chunk_${idx}.ogg`,languageCode:"ko"});break;}
      catch(err){
        if(err instanceof TranscriptionError && err.code==="NO_SPEECH")break;
        const status=err instanceof TranscriptionError ? (err.detail as {status?:number}|undefined)?.status : undefined;
        const retryable=err instanceof TranscriptionError && (err.code==="TIMEOUT"||(status!=null&&status>=500&&status<600));
        if(!retryable||attempt>=AUDIO_POLICY.retries)throw err;
        await new Promise(r=>setTimeout(r,AUDIO_POLICY.retryBaseMs*2**attempt));
      }
    }
    sttMs = Date.now() - t0;
    // 조각 안의 화자는 사이드카 화자분리로 다시 나눈다(공급자 화자 번호는 여러 사람을 한 번호로 합친다).
    const spoken = result ? await withSidecarSpeakers(result, wav) : null;
    const utts = spoken?.result.utterances ?? [];

    // 조각 사이 화자 잇기. 화자 정보가 없으면 조각 전체를 한 화자 후보(X)로 둔다.
    const segments = utts
      .filter((u) => u.startMs != null && u.endMs != null)
      .map((u) => ({ local: u.speakerId ?? "X", startMs: u.startMs as number, endMs: u.endMs as number }));
    const link = segments.length
      ? await linkChunk({ audioPath: wav, segments, registry: e.registry, chunkIndex: speakerChunkIndex(e.sessionId,idx) })
      : { mapping: {}, confidence: {}, registry: e.registry, method: e.linkMethod ?? "embedding", similarities: [] };
    e.registry = link.registry;
    e.linkMethod = link.method;

    const d = db();
    const base = (d.prepare(`SELECT COUNT(*) AS n FROM utterances WHERE meeting_id = ?`).get(e.meetingId) as { n: number }).n;
    const ins = d.prepare(
      `INSERT INTO utterances (id, meeting_id, idx, uid, speaker_id, speaker_name, role, ts_start, ts_end, text_raw, text_clean,
         start_ms, end_ms, confidence, transcription_provider, transcription_model, source_file_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const items: { uid: string; speakerId: string | null; speakerName: string | null; startMs: number | null; endMs: number | null; text: string; provisional: boolean }[] = [];
    d.exec("BEGIN IMMEDIATE");
    try {
      utts.forEach((u, k) => {
        const n = base + k;
        const u_id = `U-${pad(n + 1)}`;
        const sp = u.speakerId ?? "X";
        const speakerId = (link.mapping as Record<string, string>)[sp] ?? null;
        const s = u.startMs != null ? u.startMs + offsetMs : null;
        const en = u.endMs != null ? Math.min(u.endMs,durationMs??u.endMs) + offsetMs : offsetMs + (durationMs??0);
        ins.run(uid(), e.meetingId, n, u_id, speakerId, null, null, s != null ? msToClock(s) : null, en != null ? msToClock(en) : null, u.text, u.text, s, en, null, result?.provider ?? "openrouter", result?.model ?? null, `live:${e.sessionId}#${idx}`, now());
        items.push({ uid: u_id, speakerId, speakerName: null, startMs: s, endMs: en, text: u.text, provisional: true });
      });
    d.prepare(
      `INSERT OR REPLACE INTO live_chunks (session_id, idx, offset_ms, duration_ms, file_path, status, error, stt_ms, link_json, utterance_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(e.sessionId, idx, offsetMs, durationMs, wav, "done", null, sttMs, JSON.stringify({ method: link.method, mapping: link.mapping, confidence: link.confidence, similarities: link.similarities }), items.length, now());
    d.prepare(`UPDATE live_sessions SET registry_json = ?, link_method = ? WHERE id = ?`).run(
      JSON.stringify(e.registry.map((r) => ({ id: r.id, speechMs: r.speechMs, centroid: r.centroid }))),
      e.linkMethod,
      e.sessionId,
    );
      d.exec("COMMIT");
    } catch (err) {
      try {
        d.exec("ROLLBACK");
      } catch {}
      throw err;
    }
    if (items.length) publish(e.meetingId, { type: "utterances", items });
    publish(e.meetingId, { type: "chunk", sessionId: e.sessionId, idx, offsetMs, sttMs, utterances: items.length, linkMethod: link.method, status:"done" });
    scheduleWindow(e, false);
  } catch (err) {
    const msg = (err as Error).message;
    db()
      .prepare(`INSERT OR REPLACE INTO live_chunks (session_id, idx, offset_ms, duration_ms, file_path, status, error, stt_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(e.sessionId, idx, offsetMs, durationMs, wav, "failed", msg, sttMs, now());
    publish(e.meetingId, { type: "chunk", sessionId: e.sessionId, idx, offsetMs, sttMs, utterances: 0, linkMethod: e.linkMethod ?? "-", error: msg, status:"failed" });
  } finally {
    if (!e.windowRunning) publish(e.meetingId, { type: "status", stage: "idle", label: "대기 중" });
  }
}

/** 새 발언이 windowSize 개 이상 쌓였거나 force 면 창 분석을 돌린다. 한 번에 하나만. */
function scheduleWindow(e: Engine, force: boolean): Promise<void> | void {
  if(e.facilitator) return advanceFacilitator(e.sessionId,e.mediaEndMs,force);
  const all = getMeetingUtterances(e.meetingId);
  const pending = all.length - e.analyzedUpTo;
  if (pending <= 0) return;
  if (!force && pending < e.windowSize) return;
  if (e.windowRunning) {
    e.windowAgain = true;
    return;
  }
  e.windowRunning = true;
  const take = Math.min(pending, e.windowSize * 2);
  const window = all.slice(e.analyzedUpTo, e.analyzedUpTo + take);
  const context = all.slice(Math.max(0, e.analyzedUpTo - 6), e.analyzedUpTo);
  publish(e.meetingId, { type: "status", stage: "analysis", label: "안건 분석 중" });
  const ctx = getMeetingContext(e.meetingId);
  return runWindow(e.state, {
    allUtts: all.slice(0, e.analyzedUpTo + take),
    context,
    window,
    meeting: { projectTitle: ctx.projectTitle, sceneLine: ctx.sceneLine },
    signal: e.abort.signal,
  })
    .then((r) => {
      for (const i of r.newIssues) {
        upsertIssue(e.runId, i);
        publish(e.meetingId, { type: "issue", op: "new", issue: i });
      }
      for (const i of r.updatedIssues) {
        upsertIssue(e.runId, i);
        publish(e.meetingId, { type: "issue", op: "update", issue: i });
      }
      publish(e.meetingId, {
        type: "window",
        from: window[0].uid,
        to: window[window.length - 1].uid,
        newIds: r.newIssues.map((i) => i.issue_id),
        updatedIds: r.updatedIssues.map((i) => i.issue_id),
        latencyMs: r.latencyMs,
      });
      e.analyzedUpTo += take;
    })
    .catch((err) => {
      publish(e.meetingId, { type: "status", stage: "idle", label: `안건 분석 실패: ${(err as Error).message.slice(0, 120)}` });
      // 실패한 창은 건너뛰지 않는다. 다음 조각이 오면 같은 발언부터 다시 시도한다.
    })
    .finally(() => {
      e.windowRunning = false;
      publish(e.meetingId, { type: "status", stage: "idle", label: "대기 중" });
      if (e.windowAgain) {
        e.windowAgain = false;
        void scheduleWindow(e, e.stopping);
      }
    });
}

/**
 * 정지. 들어온 조각을 모두 처리하고, 남은 발언을 마지막 창으로 분석한 뒤 run 을 닫는다.
 * 전체 녹음은 조각을 이어 붙여 full.wav 로 남긴다(확정 전사용).
 */
export async function stopSession(sessionId: string): Promise<{ utterances: number; issues: number; fullAudio: string | null }> {
  const e = engines.get(sessionId);
  if (!e) throw new LiveError("NOT_FOUND", "라이브 세션을 찾을 수 없습니다.");
  if(e.stopping)throw new LiveError("STOPPED","종료 처리가 이미 진행 중입니다.");
  e.stopping = true;
  db().prepare(`UPDATE live_sessions SET status = 'stopping', stopped_at=COALESCE(stopped_at,?) WHERE id = ?`).run(now(),sessionId);
  publish(e.meetingId, { type: "session", sessionId, status: "stopping" });
  await e.queue;
  const pendingChunks = (db().prepare("SELECT COUNT(*) n FROM live_chunks WHERE session_id=? AND status!='done'").get(sessionId) as {n:number}).n;
  if (pendingChunks) {
    e.stopping = false;
    db().prepare("UPDATE live_sessions SET status='recording' WHERE id=?").run(sessionId);
    publish(e.meetingId, {type:"session", sessionId, status:"recording"});
    throw new LiveError("PENDING_CHUNKS", `${pendingChunks}개 녹음 조각의 전사가 남았습니다. 저장된 녹음 재전송을 누른 뒤 종료해 주세요.`);
  }
  // 도는 창이 끝나기를 기다렸다가 남은 발언을 마저 분석한다.
  if(e.facilitator) await advanceFacilitator(e.sessionId,e.mediaEndMs,true);
  for (let guard = 0; !e.facilitator && guard < 3; guard++) {
    while (e.windowRunning) await new Promise((r) => setTimeout(r, 300));
    const pending = getMeetingUtterances(e.meetingId).length - e.analyzedUpTo;
    if (pending <= 0) break;
    const before=e.analyzedUpTo;
    await scheduleWindow(e, true);
    if(e.analyzedUpTo===before)break;
  }
  const finalReview=e.facilitator?getFacilitatorState(e.meetingId):null;
  if(e.facilitator && (finalReview?.error || !finalReview || finalReview.processedMs<e.mediaEndMs))throw new Error("마지막 구간 분석을 마치지 못했습니다. 종료 처리를 다시 시도해 주세요.");
  if(!e.facilitator && getMeetingUtterances(e.meetingId).length>e.analyzedUpTo)throw new Error("남은 발언 분석을 마치지 못했습니다. 종료 처리를 다시 시도해 주세요.");
  e.chunkFiles=(db().prepare("SELECT file_path FROM live_chunks WHERE session_id=? AND status='done' ORDER BY idx").all(sessionId) as {file_path:string}[]).map(c=>c.file_path);
  if(e.chunkFiles.some(f=>!f||!existsSync(f)))throw new Error("합칠 녹음 조각이 누락되었습니다. 저장된 원본을 복구한 뒤 종료 처리를 다시 시도해 주세요.");
  let fullAudio: string | null = null;
  if (e.chunkFiles.length) {
    const list = path.join(LIVE_DIR, sessionId, "concat.txt");
    writeFileSync(list, e.chunkFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    const out = path.join(LIVE_DIR, sessionId, "full.wav");
    const { execFile } = await import("node:child_process");
    await new Promise<void>((res,reject) => execFile("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], {timeout:120_000}, (error) => error ? reject(new Error("녹음 파일 합치기에 실패했습니다. 저장된 조각으로 다시 시도해 주세요.")) : res()));
    await probeDurationMs(out);
    fullAudio = out;
  }
  const utterances = getMeetingUtterances(e.meetingId).length;
  const facilitatorState = e.facilitator ? getFacilitatorState(e.meetingId) : null;
  finishRun(e.runId, {
    status: (e.facilitator ? getFacilitatorState(e.meetingId)?.error : getMeetingUtterances(e.meetingId).length > e.analyzedUpTo) ? "failed" : "completed",
    windowCount: facilitatorState?.reviews.length ?? e.state.windows.length,
    latencyMs: e.state.windows.reduce((a, w) => a + w.latencyMs, 0),
    usage: {
      calls: e.state.usages.length,
      costUsd: e.state.usages.every((u) => u.costUsd !== null) ? e.state.usages.reduce((a, u) => a + (u.costUsd ?? 0), 0) : null,
    },
    stats: { windows: e.state.windows, linkMethod: e.linkMethod, speakers: e.registry.length },
    agreements: e.state.agreements,
  });
  saveSegment(sessionId,e.meetingId);
  db().prepare(`UPDATE live_sessions SET status = 'stopped', error=NULL, stopped_at = COALESCE(stopped_at,?), full_audio = ? WHERE id = ?`).run(now(), fullAudio, sessionId);
  publish(e.meetingId, { type: "session", sessionId, status: "stopped" });
  engines.delete(sessionId);
  return { utterances, issues: e.state.issues.size, fullAudio };
}

/** Explicit recovery: successful chunks are not retranscribed after a process restart. */
export function resumeSession(meetingId:string,sessionId:string,finishOnly=false):Engine {
  const current=engines.get(sessionId);
  if(current){if(current.meetingId!==meetingId||current.stopping)throw new LiveError("STOPPED","복구할 수 없는 세션입니다.");retryQueuedChunks(current);return current;}
  if(activeSessionFor(meetingId))throw new LiveError("ALREADY_RUNNING","다른 녹음 세션이 실행 중입니다.");
  const row=db().prepare("SELECT * FROM live_sessions WHERE id=? AND meeting_id=?").get(sessionId,meetingId) as {run_id:string;status:string;mode:string;registry_json:string;link_method:string|null}|undefined;
  const config=getFacilitatorState(meetingId);
  const failedFinish=finishOnly&&row?.status==="stopped"&&!!db().prepare("SELECT id FROM alignment_v2_runs WHERE id=? AND status='failed'").get(row.run_id);
  if(!row||(!["recording","stopping"].includes(row.status)&&!failedFinish)||row.mode!=="mic"||config?.sessionId!==sessionId)throw new LiveError("NOT_FOUND","복구할 진행 보조 녹음 세션이 없습니다.");
  const chunks=db().prepare("SELECT * FROM live_chunks WHERE session_id=? ORDER BY idx").all(sessionId) as {idx:number;offset_ms:number;duration_ms:number|null;file_path:string;status:string}[];
  const e:Engine={sessionId,meetingId,runId:row.run_id,mode:"mic",facilitator:{goal:config.goal,intervalMinutes:config.intervalMinutes as 3|5|10},mediaEndMs:segmentBase(sessionId),acceptedOffsets:new Map(),windowSize:12,state:newWindowState(meetingId,row.run_id),registry:JSON.parse(row.registry_json),analyzedUpTo:0,chunkIdx:Math.max(-1,...chunks.map(c=>c.idx))+1,queue:Promise.resolve(),windowRunning:false,windowAgain:false,stopping:false,linkMethod:row.link_method,chunkFiles:[],abort:new AbortController()};
  const dir=path.join(LIVE_DIR,sessionId),files=readdirSync(dir);
  for(const c of chunks){
    const rawName=files.find(f=>f.startsWith(`raw_${pad(c.idx)}.`));const raw=rawName?path.join(dir,rawName):null;
    if(raw)e.acceptedOffsets.set(c.offset_ms,createHash("sha256").update(readFileSync(raw)).digest("hex"));
    if(c.status==="done"){e.mediaEndMs=Math.max(e.mediaEndMs,c.offset_ms+(c.duration_ms??0));if(existsSync(c.file_path))e.chunkFiles.push(c.file_path);}

  }
  retryQueuedChunks(e);
  engines.set(sessionId,e);db().prepare("UPDATE live_sessions SET status='recording',error=NULL WHERE id=?").run(sessionId);
  publish(meetingId,{type:"session",sessionId,status:"recording",mode:"mic"});return e;
}

function retryQueuedChunks(e:Engine){
  e.queue=e.queue.then(async()=>{
    const rows=db().prepare("SELECT idx,offset_ms FROM live_chunks WHERE session_id=? AND status!='done' ORDER BY idx").all(e.sessionId) as {idx:number;offset_ms:number}[];
    const dir=path.join(LIVE_DIR,e.sessionId),files=readdirSync(dir);
    for(const row of rows){
      const file=files.find(f=>f.startsWith(`raw_${pad(row.idx)}.`));
      if(!file){
        const error="서버에 원본 녹음 조각이 없습니다. 브라우저 저장본을 내려받아 복구해 주세요.";
        db().prepare("UPDATE live_chunks SET status='failed',error=? WHERE session_id=? AND idx=?").run(error,e.sessionId,row.idx);
        publish(e.meetingId,{type:"chunk",sessionId:e.sessionId,idx:row.idx,offsetMs:row.offset_ms,sttMs:null,utterances:0,linkMethod:"-",status:"failed",error});
        break;
      }
      await processChunk(e,row.idx,path.join(dir,file),row.offset_ms);
      const state=db().prepare("SELECT status FROM live_chunks WHERE session_id=? AND idx=?").get(e.sessionId,row.idx) as {status:string};if(state.status!=="done")break;
    }
  });
}
