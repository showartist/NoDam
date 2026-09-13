import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { getCurrentRun, getIssue } from "@/lib/alignment/store";
import { ResolutionError, resolveIssue } from "@/lib/alignment/resolution";

export const runtime = "nodejs";

/** POST — 사람의 합의 승인. 승인자 이름이 없으면 거부한다. AI 는 이 경로를 부르지 않는다. */
export async function POST(req: Request, props: { params: Promise<{ id: string; issueId: string }> }) {
  const { id, issueId } = await props.params;
  const body = (await req.json().catch(() => ({}))) as { runId?: string; selected?: unknown; summary?: string; resolvedBy?: string };
  const runId = body.runId ?? getCurrentRun(id, { includeRunning: true })?.id;
  if (!runId) return NextResponse.json({ error: "분석을 돌린 적이 없습니다." }, { status: 404 });
  const meeting = db().prepare(`SELECT project_id FROM meetings WHERE id = ?`).get(id) as { project_id: string } | undefined;
  if (!meeting) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  try {
    const r = resolveIssue({
      meetingId: id,
      runId,
      issueId,
      selected: (body.selected ?? []) as never,
      summary: body.summary ?? "",
      resolvedBy: body.resolvedBy ?? "",
      projectId: meeting.project_id,
    });
    return NextResponse.json({ ok: true, ...r, issue: getIssue(id, issueId, runId) });
  } catch (e) {
    if (e instanceof ResolutionError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "ALREADY_RESOLVED" ? 409 : 400;
      return NextResponse.json({ code: e.code, error: e.message }, { status });
    }
    if (e instanceof ZodError) return NextResponse.json({ error: "고른 값의 형식이 맞지 않습니다." }, { status: 400 });
    throw e;
  }
}
