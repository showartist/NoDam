import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { searchPastMeetings } from "@/lib/consistency/ledger";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET ?q= — 같은 작품의 다른 회의에서 질의와 가까운 발언(과거 회의 검색, 중간보고서 기술 10번). */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "q 가 필요합니다." }, { status: 400 });
  const m = db().prepare(`SELECT project_id FROM meetings WHERE id = ?`).get(id) as { project_id: string } | undefined;
  if (!m) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  try {
    const hits = await searchPastMeetings(m.project_id, q, { excludeMeetingId: id, k: 6 });
    return NextResponse.json({ query: q, hits });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
