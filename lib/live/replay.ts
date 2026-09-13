/**
 * 재생 모드: 녹음 파일을 회의 중 입력처럼 조각으로 흘려 보낸다(발표·리허설용, 계획서 8절 대체 경로).
 * 조각을 실제 시간(또는 speed 배속)에 맞춰 넣으므로 마이크 입력과 같은 경로를 탄다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { splitAudio } from "../audio/ffmpeg";
import { publish } from "./bus";
import { getEngine, ingestChunk, LIVE_DIR, stopSession } from "./session";

const g = globalThis as unknown as { __scenenoteReplay?: Map<string, { cancel: boolean }> };
const jobs: Map<string, { cancel: boolean }> = (g.__scenenoteReplay ??= new Map());

export function cancelReplay(sessionId: string): void {
  const j = jobs.get(sessionId);
  if (j) j.cancel = true;
}

/** 백그라운드로 재생을 시작한다. 끝나면 세션을 정지한다. */
export function startReplay(sessionId: string, sourceFile: string, opts: { speed?: number; chunkMs?: number } = {}): void {
  const e = getEngine(sessionId);
  if (!e) throw new Error("라이브 세션을 찾을 수 없습니다.");
  const speed = Math.max(0.5, Math.min(opts.speed ?? 1, 8));
  const chunkMs = opts.chunkMs ?? Number(process.env.SCENENOTE_LIVE_CHUNK_MS ?? 20000);
  const job = { cancel: false };
  jobs.set(sessionId, job);
  void (async () => {
    try {
      const chunks = await splitAudio(sourceFile, path.join(LIVE_DIR, sessionId, "replay"), chunkMs, 0);
      for (const c of chunks) {
        if (job.cancel) break;
        // 실제 녹음처럼, 조각 길이만큼 기다린 뒤에 조각이 도착한다.
        await new Promise((r) => setTimeout(r, c.durationMs / speed));
        if (job.cancel) break;
        void ingestChunk(sessionId, { bytes: readFileSync(c.file), ext: "wav", offsetMs: c.offsetMs });
      }
      if (!job.cancel) await stopSession(sessionId);
    } catch (err) {
      publish(e.meetingId, { type: "session", sessionId, status: "failed", error: (err as Error).message });
    } finally {
      jobs.delete(sessionId);
    }
  })();
}
