import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentRun, getIssue } from "@/lib/alignment/store";
import { getDraft, saveDraft } from "@/lib/alignment/resolution";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; issueId: string }> };

export async function GET(_req: Request, props: Params) {
  const { id, issueId } = await props.params;
  const runId = getCurrentRun(id, { includeRunning: true })?.id;
  if (!runId) return NextResponse.json({ selected: [] });
  return NextResponse.json({ runId, selected: getDraft(runId, issueId) });
}

/** PUT — 관점 비교에서 고른 값 저장. 저장은 초안일 뿐 승인이 아니다. */
export async function PUT(req: Request, props: Params) {
  const { id, issueId } = await props.params;
  const body = (await req.json().catch(() => ({}))) as { runId?: string; selected?: unknown; by?: string };
  const runId = body.runId ?? getCurrentRun(id, { includeRunning: true })?.id;
  if (!runId || !getIssue(id, issueId, runId)) return NextResponse.json({ error: "안건을 찾을 수 없습니다." }, { status: 404 });
  try {
    saveDraft(id, runId, issueId, (body.selected ?? []) as never, body.by ?? null);
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "고른 값의 형식이 맞지 않습니다.", detail: e.issues.slice(0, 3) }, { status: 400 });
    throw e;
  }
  return NextResponse.json({ ok: true, runId, selected: getDraft(runId, issueId) });
}
