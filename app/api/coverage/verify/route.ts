import { NextResponse } from "next/server";
import { verifyCoverage } from "@/lib/intents";
import type { CoverageVerificationState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 감독 승인 — AI 제안을 approved 로 바꾸는 유일한 경로. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const linkId = String(body.linkId || "");
  const rawState = String(body.state || "");

  const stateMap: Record<string, CoverageVerificationState> = {
    verified: "approved",
    approved: "approved",
    rejected: "rejected",
    pending: "pending",
    needs_review: "pending",
  };

  const state = stateMap[rawState];
  if (!linkId) return NextResponse.json({ error: "linkId 가 필요합니다." }, { status: 400 });
  if (!state) {
    return NextResponse.json({ error: "알 수 없는 확인 상태입니다." }, { status: 400 });
  }

  const row = verifyCoverage(linkId, state);
  if (!row) return NextResponse.json({ error: "커버리지 주장을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, link: row });
}
