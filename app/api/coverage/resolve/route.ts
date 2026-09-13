import { NextResponse } from "next/server";
import { applyCoverageFix } from "@/lib/coverage";
import { COVERAGE_ACTIONS, type CoverageActionKey } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Coverage gap 해결 — 감독이 고른 안을 적용하고 순서·Previs·제작 영향을 갱신한다. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const meetingId = String(body.meetingId || "");
  const intentId = String(body.intentId || "");
  const action = body.action as CoverageActionKey;

  if (!meetingId || !intentId) {
    return NextResponse.json({ error: "meetingId 와 intentId 가 필요합니다." }, { status: 400 });
  }
  if (!(COVERAGE_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "알 수 없는 해결안입니다." }, { status: 400 });
  }

  const result = applyCoverageFix({
    meetingId,
    intentId,
    action,
    targetShotNumber: body.targetShotNumber,
    afterShotNumber: body.afterShotNumber,
    role: body.role,
  });
  if (!result) return NextResponse.json({ error: "의도를 찾을 수 없습니다." }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.summary }, { status: 409 });
  return NextResponse.json(result);
}
