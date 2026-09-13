import { NextResponse } from "next/server";
import { toggleRepresentative } from "@/lib/intents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 대시보드에 보여줄 대표 컷 지정 — 사용자가 직접 고른다. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const shotId = String(body.shotId || "");
  if (!shotId) return NextResponse.json({ error: "shotId 가 필요합니다." }, { status: 400 });
  const now = toggleRepresentative(shotId);
  if (now === null) return NextResponse.json({ error: "쇼트를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, is_representative: now });
}
