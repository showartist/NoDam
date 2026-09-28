/** 재개 가능한 OpenRouter 조각 전사. 성공 조각은 JSON 체크포인트에 즉시 보존한다. */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync, openSync, closeSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { probeDurationMs, extractAudioChunk, toOpus } from "../audio/ffmpeg";
import { OpenRouterTranscriptionProvider, buildUtterances } from "./providers/openrouter";
import { withSidecarSpeakers } from "./withSpeakers";
import { TranscriptionError, type TranscriptResult, type TranscriptWord } from "./types";
import { audioReviewFlags, type AudioReviewFlag } from "./review";
import { AUDIO_POLICY as P } from "./policy";

export type LongResult = TranscriptResult & {
  reviewFlags: AudioReviewFlag[];
  method: "chunked";
  speakerSource: "sidecar" | "provider" | "none";
  speakerNote: string | null;
  chunks: { index: number; offsetMs: number; durationMs: number; sttMs: number; words: number }[];
};
type JobChunk = { index: number; offsetMs: number; durationMs: number };
export type AudioJob = {
  id: string; meetingId: string; file: string; fileName: string; durationMs: number;
  overlapMs: number; numSpeakers?: number | null; chunks: JobChunk[];
};
type Checkpoint = { index: number; words: TranscriptWord[]; sttMs: number; attempts: number; error?: string; code?: string };
export function jobsRoot() { return path.resolve(process.env.SCENENOTE_DATA_DIR ?? ".data", "transcription-jobs"); }
export function jobDirectory(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("잘못된 작업 ID입니다.");
  return path.join(jobsRoot(), id);
}
export function saveJobJson(dir: string, name: string, data: unknown) {
  const target = path.join(dir, name), temp = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(data)); renameSync(temp, target);
}
export function readJob(id: string, meetingId?: string): AudioJob {
  const job = JSON.parse(readFileSync(path.join(jobDirectory(id), "job.json"), "utf8")) as AudioJob;
  if (meetingId !== undefined && job.meetingId !== meetingId) throw new Error("이 회의의 전사 작업이 아닙니다.");
  return job;
}
export async function createAudioJob(file: string, meetingId: string, opts: { id?: string; fileName?: string; chunkMs?: number; overlapMs?: number; numSpeakers?: number | null } = {}) {
  const chunkMs = opts.chunkMs ?? P.chunkMs, overlapMs = opts.overlapMs ?? P.overlapMs;
  if (!Number.isFinite(chunkMs) || chunkMs < 1000 || !Number.isFinite(overlapMs) || overlapMs < 0 || overlapMs >= chunkMs || chunkMs + overlapMs > P.providerTimeoutMs) {
    throw new Error("조각 길이+겹침은 60초 이하, 조각은 1초 이상이어야 합니다.");
  }
  const durationMs = await probeDurationMs(file), id = opts.id ?? randomUUID();
  const chunks: JobChunk[] = [];
  for (let start = 0, index = 0; start < durationMs; start += chunkMs, index++) {
    const offsetMs = Math.max(0, start - (index ? overlapMs : 0));
    chunks.push({ index, offsetMs, durationMs: Math.min(durationMs - offsetMs, chunkMs + (index ? overlapMs : 0)) });
  }
  const job: AudioJob = { id, meetingId, file: path.resolve(file), fileName: opts.fileName ?? path.basename(file), durationMs, overlapMs, numSpeakers: opts.numSpeakers, chunks };
  mkdirSync(jobDirectory(id), { recursive: true }); saveJobJson(jobDirectory(id), "job.json", job);
  return job;
}
function checkpoint(job: AudioJob, index: number): Checkpoint | null {
  const file = path.join(jobDirectory(job.id), `${index}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
export function jobProgress(job: AudioJob) {
  const saved = job.chunks.map(c => checkpoint(job, c.index));
  return { jobId: job.id, totalChunks: job.chunks.length, completedChunks: saved.filter(c => c && !c.error).length,
    failedChunks: saved.filter((c): c is Checkpoint => !!c?.error).map(c => ({ index: c.index, error: c.error, code: c.code, attempts: c.attempts })),
    pendingChunks: saved.filter(c => !c).length };
}
function retryable(e: unknown) {
  if (!(e instanceof TranscriptionError)) return false;
  const status = (e.detail as { status?: number } | undefined)?.status;
  return e.code === "TIMEOUT" || (status !== undefined && status >= 500 && status <= 599);
}
async function processChunk(job: AudioJob, c: JobChunk) {
  const dir = jobDirectory(job.id), wav = path.join(dir, `${c.index}.wav`), ogg = path.join(dir, `${c.index}.ogg`);
  const started = Date.now(); let attempts = 0;
  try {
    await extractAudioChunk(job.file, wav, c.offsetMs, c.durationMs, P.encodeTimeoutMs);
    await toOpus(wav, ogg, P.encodeTimeoutMs);
    const b = readFileSync(ogg), audio = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    let result: TranscriptResult | null = null;
    for (;;) {
      attempts++;
      try { result = await new OpenRouterTranscriptionProvider().transcribe({ audio, fileName: path.basename(ogg), languageCode: "ko" }); break; }
      catch (e) {
        if (e instanceof TranscriptionError && e.code === "NO_SPEECH") break;
        if (!retryable(e) || attempts > P.retries) throw e;
        await new Promise(r => setTimeout(r, P.retryBaseMs * 2 ** (attempts - 1)));
      }
    }
    if (result && !result.words?.length) throw new TranscriptionError("TRANSCRIPTION_FAILED", "단어 시간이 없어 경계 중복을 판정할 수 없습니다.");
    saveJobJson(dir, `${c.index}.json`, { index: c.index, words: result?.words ?? [], sttMs: Date.now() - started, attempts } satisfies Checkpoint);
  } catch (e) {
    saveJobJson(dir, `${c.index}.json`, { index: c.index, words: [], sttMs: Date.now() - started, attempts, error: (e as Error).message, code: e instanceof TranscriptionError ? e.code : "AUDIO_DECODE_FAILED" } satisfies Checkpoint);
  } finally { rmSync(wav, { force: true }); rmSync(ogg, { force: true }); }
}
/** 각 HTTP 요청은 최대 2개만 처리. 다음 요청/프로세스가 같은 파일로 이어간다. */
export async function processAudioBatch(job: AudioJob, retryFailed = false) {
  const dir = jobDirectory(job.id), lock = path.join(dir, "batch.lock");
  if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > P.requestSeconds * 1000 + 30_000) rmSync(lock);
  const fd = openSync(lock, "wx");
  try {
    if (retryFailed) for (const c of job.chunks) if (checkpoint(job, c.index)?.error) rmSync(path.join(dir, `${c.index}.json`));
    const pending = job.chunks.filter(c => !checkpoint(job, c.index)).slice(0, P.concurrency);
    await Promise.all(pending.map(c => processChunk(job, c)));
    return jobProgress(job);
  } finally { closeSync(fd); rmSync(lock, { force: true }); }
}
export async function finishAudioJob(job: AudioJob): Promise<LongResult> {
  const progress = jobProgress(job);
  if (progress.pendingChunks || progress.failedChunks.length) throw new TranscriptionError("TRANSCRIPTION_FAILED", "미완료 조각이 있습니다. 성공 조각은 보존했습니다.", progress);
  const words: TranscriptWord[] = [], meta: LongResult["chunks"] = [];
  for (const c of job.chunks) {
    const saved = checkpoint(job, c.index)!;
    const ownStart = c.index === 0 ? 0 : c.offsetMs + job.overlapMs / 2;
    const next = job.chunks[c.index + 1], ownEnd = next ? next.offsetMs + job.overlapMs / 2 : job.durationMs + 1;
    let kept = 0;
    for (const w of saved.words) {
      const startMs = w.startMs + c.offsetMs, endMs = w.endMs + c.offsetMs, mid = (startMs + endMs) / 2;
      if (mid < ownStart || mid >= ownEnd) continue;
      words.push({ ...w, startMs, endMs, speaker: w.speaker != null ? `C${c.index + 1}-${w.speaker}` : null }); kept++;
    }
    meta.push({ ...c, sttMs: saved.sttMs, words: kept });
  }
  if (!words.length) throw new TranscriptionError("NO_SPEECH", "오디오에서 발언을 찾지 못했습니다.");
  const provider = new OpenRouterTranscriptionProvider();
  const fallback = buildUtterances(words.map(w => ({ word: w.text, start: w.startMs / 1000, end: w.endMs / 1000, speaker: w.speaker })), [], "", job.durationMs);
  const base: TranscriptResult = { provider: "openrouter", model: provider.model, language: "ko", text: words.map(w => w.text).join(" "), utterances: fallback.utterances,
    diarizationStatus: "unsupported", speakerCount: null, durationMs: job.durationMs, sourceFileName: job.fileName, words };
  // 화자 분석은 조각 처리와 별도 요청에서 실행. 실패해도 전사 글자는 남기고 화자 미확인으로 표시한다.
  const s = await withSidecarSpeakers(base, job.file, { numSpeakers: job.numSpeakers, timeoutMs: 120_000 })
    .catch((e: Error) => ({ result: base, speakerSource: "none" as const, note: `화자분리 실패: ${e.message}` }));
  const result = s.result.diarizationStatus === "ok" ? s.result : { ...s.result, speakerCount: null, utterances: s.result.utterances.map(u => ({...u, speakerId: null, speakerName: null})) };
  return { ...result, reviewFlags: audioReviewFlags(meta,words), method: "chunked", speakerSource: s.speakerSource === "provider" ? "none" : s.speakerSource, speakerNote: s.note, chunks: meta };
}
/** CLI용 전체 반복. 웹 업로드는 processAudioBatch를 요청마다 호출한다. */
export async function transcribeLong(file: string, opts: { chunkMs?: number; overlapMs?: number; numSpeakers?: number | null; jobId?: string } = {}): Promise<LongResult> {
  const job = opts.jobId ? readJob(opts.jobId) : await createAudioJob(file, "cli", opts);
  while (jobProgress(job).pendingChunks) await processAudioBatch(job);
  return finishAudioJob(job);
}
