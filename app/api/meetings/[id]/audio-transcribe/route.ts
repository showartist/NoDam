import { NextResponse } from "next/server";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getTranscriptionProvider, TranscriptionError } from "@/lib/transcription";
import { createAudioJob, jobDirectory, readJob, jobProgress, processAudioBatch, finishAudioJob, saveJobJson } from "@/lib/transcription/long";
import { streamAudioUpload } from "@/lib/transcription/upload";
import { replaceMeetingTranscript } from "@/lib/transcription/save";

export const runtime = "nodejs";
// AUDIO_POLICY.requestSeconds와 동일. Next는 정적 리터럴을 요구한다.
export const maxDuration = 300;

/** 업로드(202) → 요청당 2개 전사(202) → 별도 완료 요청에서만 원문 교체. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  try {
    getTranscriptionProvider();
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const id = randomUUID(), dir = jobDirectory(id); mkdirSync(dir, { recursive: true });
      try {
        const upload = await streamAudioUpload(req, dir);
        const speakers = Number(new URL(req.url).searchParams.get("speakers"));
        const job = await createAudioJob(upload.file, meetingId, { id, fileName: upload.fileName, numSpeakers: speakers > 1 && speakers <= 20 ? speakers : null });
        return NextResponse.json({ success: true, status: "queued", ...jobProgress(job) }, { status: 202 });
      } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
    }
    const body = await req.json();
    if (typeof body.jobId !== "string") return fail(400, "INVALID_JOB", "작업 ID가 필요합니다.");
    const job = readJob(body.jobId, meetingId), dir = jobDirectory(job.id);
    const responseFile = path.join(dir, "response.json");
    if (existsSync(responseFile)) return NextResponse.json(JSON.parse(readFileSync(responseFile, "utf8")));
    let progress = jobProgress(job);
    if (progress.pendingChunks || (body.retryFailed === true && progress.failedChunks.length)) {
      progress = await processAudioBatch(job, body.retryFailed === true);
      return NextResponse.json({ success: true, status: progress.pendingChunks ? "processing" : "ready", ...progress }, { status: 202 });
    }
    if (progress.failedChunks.length) return NextResponse.json({ success: false, code: "PARTIAL_TRANSCRIPTION", error: "일부 조각 전사 실패. 성공 조각은 보존했으며 기존 회의록은 변경하지 않았습니다.", ...progress }, { status: 502 });
    const result = await finishAudioJob(job);
    const method = `${result.method}+${result.speakerSource}`;
    const { runId } = replaceMeetingTranscript(meetingId, result, method, {file:job.file,flags:result.reviewFlags});
    const response = { success: true, status: "completed", jobId: job.id, runId, provider: result.provider, model: result.model, language: result.language,
      sourceFileName: result.sourceFileName, durationMs: result.durationMs, diarizationStatus: result.diarizationStatus, speakerCount: result.speakerCount,
      method, chunkCount: result.chunks.length, speakerNote: result.speakerNote, utteranceCount: result.utterances.length,
      utterances: result.utterances.map((u, i) => ({ ...u, uid: `U-${String(i + 1).padStart(3, "0")}` })) };
    saveJobJson(dir, "response.json", response);
    return NextResponse.json(response);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return fail(409, "JOB_BUSY", "같은 작업이 처리 중입니다. 잠시 후 이어서 처리하세요.");
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fail(404, "JOB_NOT_FOUND", "전사 작업을 찾을 수 없습니다.");
    if (e instanceof TranscriptionError) return fail(e.code === "NOT_CONFIGURED" ? 503 : e.code === "UNSUPPORTED_FORMAT" ? 400 : e.code === "NO_SPEECH" ? 422 : 502, e.code, e.message);
    return fail(400, "TRANSCRIPTION_FAILED", (e as Error).message);
  }
}
function fail(status: number, code: string, error: string) { return NextResponse.json({ success: false, code, error }, { status }); }
