import { NextResponse } from "next/server";
import { getCurrentRun, getIssue, setIssueState } from "@/lib/alignment/store";
import { getDraft, getResolution } from "@/lib/alignment/resolution";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; issueId: string }> };

export async function GET(req: Request, props: Params) {
  const { id, issueId } = await props.params;
  const runId = new URL(req.url).searchParams.get("run") ?? getCurrentRun(id, { includeRunning: true })?.id ?? null;
  if (!runId) return NextResponse.json({ error: "분석을 돌린 적이 없습니다." }, { status: 404 });
  const issue = getIssue(id, issueId, runId);
  if (!issue) return NextResponse.json({ error: "안건을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ runId, issue, draft: getDraft(runId, issueId), resolution: getResolution(runId, issueId) });
}

/** PATCH — 사람이 안건을 제외하거나 다시 여는 것만 받는다. 승인은 /resolve 로만 한다. */
export async function PATCH(req: Request, props: Params) {
  const { id, issueId } = await props.params;
  const body = (await req.json().catch(() => ({}))) as { state?: string; actor?: string; runId?: string };
  const runId = body.runId ?? getCurrentRun(id, { includeRunning: true })?.id;
  if (!runId) return NextResponse.json({ error: "분석을 돌린 적이 없습니다." }, { status: 404 });
  if (body.state !== "dismissed" && body.state !== "open") {
    return NextResponse.json({ error: "여기서는 제외(dismissed)와 다시 열기(open)만 할 수 있습니다. 승인은 합의 화면에서 합니다." }, { status: 400 });
  }
  if (!body.actor?.trim()) return NextResponse.json({ error: "누가 바꾸는지 이름이 필요합니다." }, { status: 400 });
  if (!getIssue(id, issueId, runId)) return NextResponse.json({ error: "안건을 찾을 수 없습니다." }, { status: 404 });
  setIssueState(runId, issueId, body.state, body.state === "dismissed" ? body.actor.trim() : null);
  return NextResponse.json({ ok: true, issue: getIssue(id, issueId, runId) });
}
