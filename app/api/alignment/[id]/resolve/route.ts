import { NextResponse } from "next/server";
import { resolveSceneIssue } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Scene Issue 해결 — 사람이 고른 선택지를 저장하고 변경 영향을 표시한다. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const meetingId = String(body.meetingId || "m_01");
  const action =
    body.action === "keep" || body.action === "request_revision" || body.action === "regenerate"
      ? body.action
      : "regenerate";

  const result = resolveSceneIssue(id, {
    meetingId,
    selectedOption: body.selectedOption ?? body.selectedMeaning,
    action,
    actor: "current_user",
  });

  if (!result) return NextResponse.json({ error: "이슈를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, issueId: id, ...result });
}
