import { NextResponse } from "next/server";
import { db, now } from "@/lib/db";

export const runtime = "nodejs";

/** GET — 이 회의에 등장한 speaker_id 목록과 현재 매핑. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  const d = db();
  const speakers = d
    .prepare(
      `SELECT u.speaker_id AS speakerId,
              COUNT(*)      AS utteranceCount,
              m.display_name AS displayName,
              m.role         AS role
         FROM utterances u
         LEFT JOIN speaker_mappings m
                ON m.meeting_id = u.meeting_id AND m.speaker_id = u.speaker_id
        WHERE u.meeting_id = ? AND u.speaker_id IS NOT NULL
        GROUP BY u.speaker_id
        ORDER BY u.speaker_id`,
    )
    .all(meetingId);
  return NextResponse.json({ speakers });
}

/**
 * PUT — SPEAKER_01 → "대표" 매핑 저장.
 * speaker_id 는 diarization identity 이고 display_name 은 사람이 붙인 이름이다. 섞지 않는다.
 */
export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  const body = (await req.json().catch(() => null)) as { mappings?: unknown } | null;
  const list = Array.isArray(body?.mappings) ? body!.mappings : null;
  if (!list) return NextResponse.json({ error: "mappings 배열이 필요합니다." }, { status: 400 });

  const d = db();
  const ts = now();
  try {
    d.exec("BEGIN IMMEDIATE");
    const stmt = d.prepare(
      `INSERT INTO speaker_mappings (meeting_id, speaker_id, display_name, role, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(meeting_id, speaker_id)
       DO UPDATE SET display_name=excluded.display_name, role=excluded.role, updated_at=excluded.updated_at`,
    );
    for (const m of list as { speakerId?: string; displayName?: string; role?: string }[]) {
      const sid = String(m?.speakerId ?? "").trim();
      const name = String(m?.displayName ?? "").trim();
      if (!sid || !name) continue;
      stmt.run(meetingId, sid, name, m?.role ? String(m.role).trim() : null, ts);
    }
    d.exec("COMMIT");
  } catch (e) {
    try { d.exec("ROLLBACK"); } catch {}
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
