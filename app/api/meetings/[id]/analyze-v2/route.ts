import { NextResponse } from "next/server";
import { summarizeAlignmentReview } from "@/lib/analysis/reviewSummary";
import { getMeetingUtterances } from "@/lib/alignment/store";
import { AnalysisV2Error, runBatchAnalysis } from "@/lib/alignment/analyze";
import { humanTouchedCount } from "@/lib/alignment/resolution";
import { getAgreements, getCurrentRun, listIssues, listRuns } from "@/lib/alignment/store";

export const runtime = "nodejs";
export const maxDuration = 600;

/**
 * POST — 해석 차이 탐지 v2 일괄 분석. 실패도 run 으로 남는다.
 * 현재 run 에 사람이 승인·제외·선택한 안건이 있으면, confirmReplace 없이 덮지 않는다(409).
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as { contextCheck?: boolean; model?: string; confirmReplace?: boolean };
  const current = getCurrentRun(id);
  if (current && !body.confirmReplace) {
    const touched = humanTouchedCount(current.id);
    if (touched > 0) {
      return NextResponse.json(
        {
          code: "HUMAN_DECISIONS_EXIST",
          error: `현재 분석에서 사람이 손댄 안건이 ${touched}건 있습니다. 다시 분석하면 새 분석이 화면에 뜨고, 기존 승인 기록은 이전 분석에 남습니다.`,
          touched,
          runId: current.id,
        },
        { status: 409 },
      );
    }
  }
  try {
    const r = await runBatchAnalysis(id, { model: body.model, contextCheck: body.contextCheck === false ? false : {} });
    return NextResponse.json({ status: "completed", ...r });
  } catch (e) {
    const err = e instanceof AnalysisV2Error ? e : null;
    const code = err?.code ?? "LLM_FAILED";
    const status = code === "NO_INPUT" ? 422 : code === "NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json({ status: "failed", code, error: (e as Error).message, runId: err?.runId ?? null }, { status });
  }
}

/** GET — 현재 run 의 안건·합의. 돌린 적이 없으면 not_run. 예시 결과를 만들지 않는다. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const run = getCurrentRun(id, { includeRunning: true });
  const runs = listRuns(id).map((r) => ({ id: r.id, mode: r.mode, status: r.status, model: r.model, created_at: r.created_at, error: r.error }));
  if (!run) return NextResponse.json({ status: "not_run", issues: [], agreements: [], runs });
  const issues = listIssues(id, run.id);
  const utts = Object.fromEntries(getMeetingUtterances(id).map(u => [u.uid, { uid: u.uid, who: u.speakerName ?? u.speakerKey ?? "화자 미상", text: u.text }]));
  return NextResponse.json({
    review: summarizeAlignmentReview(issues),
    utts,
    status: run.status,
    run: { ...run, usage: run.usage_json ? JSON.parse(run.usage_json) : null, stats: run.stats_json ? JSON.parse(run.stats_json) : null },
    issues,
    agreements: getAgreements(id, run.id),
    runs,
  });
}
