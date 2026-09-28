import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { TranscriptionError } from "@/lib/transcription";
import { createAudioJob, readJob, jobDirectory, jobProgress } from "@/lib/transcription/long";
import { AnalysisV2Error, runBatchAnalysis } from "@/lib/alignment/analyze";
import { humanTouchedCount } from "@/lib/alignment/resolution";
import { getCurrentRun } from "@/lib/alignment/store";

export const runtime = "nodejs";
export const maxDuration = 900;


/**
 * POST — 라이브 회의 확정. 정지한 세션의 전체 녹음(full.wav)을 파일 전체 화자분리로 다시 전사하고,
 * 발언을 바꿔 넣은 뒤 회의 전체를 일괄 분석한다. 회의 중 발언·안건(잠정)은 이전 run 으로 남는다.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const segments=(db().prepare("SELECT COUNT(*) n FROM live_sessions WHERE meeting_id=?").get(id) as {n:number}).n;
  if(segments>1)return NextResponse.json({error:"여러 녹음 구간이 있는 회의입니다. 마지막 구간의 음성으로 전체 발언을 덮어쓸 수 없습니다. 저장된 발언으로 전체 체크를 실행해 주세요."},{status:409});
  const body = (await req.json().catch(() => ({}))) as { confirmReplace?: boolean; transcriptionJobId?: string };
  // 회의 중에 사람이 승인·제외·선택한 안건이 있으면 확정본이 화면을 바꾸기 전에 묻는다(analyze-v2 와 같은 규칙).
  const current = getCurrentRun(id);
  if (current && !body.confirmReplace) {
    const touched = humanTouchedCount(current.id);
    if (touched > 0) {
      return NextResponse.json(
        {
          code: "HUMAN_DECISIONS_EXIST",
          error: `회의 중 분석에서 사람이 손댄 안건이 ${touched}건 있습니다. 확정하면 새 분석이 화면에 뜨고, 기존 승인 기록은 회의 중 분석에 남습니다.`,
          touched,
          runId: current.id,
        },
        { status: 409 },
      );
    }
  }
  const s = db()
    .prepare(`SELECT id, full_audio FROM live_sessions WHERE meeting_id = ? AND status = 'stopped' ORDER BY started_at DESC LIMIT 1`)
    .get(id) as { id: string; full_audio: string | null } | undefined;
  if (!s?.full_audio || !existsSync(s.full_audio)) {
    return NextResponse.json({ error: "정지한 라이브 세션의 전체 녹음이 없습니다." }, { status: 404 });
  }
  try {
    // 긴 녹음은 전체 처리를 한 요청에 넣지 않는다. 업로드와 같은 배치 API에서 이어간다.
    if (!body.transcriptionJobId) {
      const job = await createAudioJob(s.full_audio, id);
      return NextResponse.json({ success: true, status: "queued", ...jobProgress(job) }, {status: 202});
    }
    const job = readJob(body.transcriptionJobId, id);
    if (job.file !== path.resolve(s.full_audio)) return NextResponse.json({error: "현재 라이브 녹음의 전사 작업이 아닙니다."}, {status:400});
    const resultFile = path.join(jobDirectory(job.id), "response.json");
    if (!existsSync(resultFile)) return NextResponse.json({error: "조각 전사를 먼저 완료하세요."}, {status:409});
    const t = JSON.parse(readFileSync(resultFile, "utf8"));
    const a = await runBatchAnalysis(id);
    return NextResponse.json({ ok: true, transcriptionRunId: t.runId, method: t.method, utterances: t.utteranceCount, speakers: t.speakerCount, analysisRunId: a.runId, issues: a.issues.length });
  } catch (e) {
    if (e instanceof TranscriptionError || e instanceof AnalysisV2Error) return NextResponse.json({ code: e.code, error: e.message }, { status: 502 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
