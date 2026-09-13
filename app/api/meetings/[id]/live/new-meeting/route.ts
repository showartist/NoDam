import { NextResponse } from "next/server";
import { db, now, uid } from "@/lib/db";

export const runtime = "nodejs";

/** POST — 같은 작품 아래 빈 회의를 새로 만든다. 라이브 입력은 빈 회의에서 시작한다. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const m = db().prepare(`SELECT project_id FROM meetings WHERE id = ?`).get(id) as { project_id: string } | undefined;
  if (!m) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  const meetingId = `m_live_${uid()}`;
  const title = `라이브 회의 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`;
  db().prepare(`INSERT INTO meetings (id, project_id, title, raw_transcript, created_at) VALUES (?,?,?,?,?)`).run(meetingId, m.project_id, title, "", now());
  return NextResponse.json({ meetingId, title }, { status: 201 });
}
