import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { adoptDraft, CharacterError, characterProfiles, drawCharacterDraft, extractCharacterNotes, listDrafts } from "@/lib/characters";
import { ImageGenError } from "@/lib/images/errors";
import { LlmError } from "@/lib/llm/openrouter";

export const runtime = "nodejs";
export const maxDuration = 600;

function projectOf(meetingId: string): string | null {
  const r = db().prepare(`SELECT project_id FROM meetings WHERE id = ?`).get(meetingId) as { project_id: string } | undefined;
  return r?.project_id ?? null;
}

function view(projectId: string) {
  const meetings = db()
    .prepare(
      `SELECT m.id, m.title, m.created_at,
              (SELECT COUNT(*) FROM utterances u WHERE u.meeting_id = m.id) AS utterances,
              (SELECT COUNT(*) FROM character_notes c WHERE c.meeting_id = m.id) AS notes
         FROM meetings m WHERE m.project_id = ? ORDER BY m.created_at`,
    )
    .all(projectId)
    .map((r) => ({ ...r })) as { id: string; title: string | null; created_at: string; utterances: number; notes: number }[];
  return {
    projectId,
    meetings: meetings.map((m) => ({ id: m.id, title: m.title, createdAt: m.created_at, utterances: m.utterances, read: m.notes > 0 })),
    profiles: characterProfiles(projectId),
    drafts: listDrafts(projectId).map((d) => ({ ...d, imageUrl: `/api/images/${d.image_id}` })),
  };
}

/** GET — 이 회의가 속한 작품의 인물 묘사(회의별로 모아 합친 것)와 초안 판들. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const projectId = projectOf(id);
  if (!projectId) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(view(projectId));
}

/**
 * POST — action:
 *   extract  작품의 회의마다 인물 묘사를 모은다(같은 입력이면 다시 부르지 않음)
 *   draw     { character } 초안을 그린다. 이전 판이 있으면 참조로 넣어 같은 사람으로 이어 그린다
 *   adopt    { draftId, by } 사람이 이 판을 기준으로 채택
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const projectId = projectOf(id);
  if (!projectId) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; character?: string; draftId?: string; by?: string };
  try {
    if (body.action === "extract") {
      const meetings = db().prepare(`SELECT id FROM meetings WHERE project_id = ? ORDER BY created_at`).all(projectId) as { id: string }[];
      const results = [];
      for (const m of meetings) results.push(await extractCharacterNotes(m.id));
      const cost = results.reduce((a, r) => a + (r.usage?.costUsd ?? 0), 0);
      return NextResponse.json({ results, costUsd: cost, ...view(projectId) });
    }
    if (body.action === "draw") {
      if (!body.character?.trim()) return NextResponse.json({ error: "인물 이름이 필요합니다." }, { status: 400 });
      const r = await drawCharacterDraft({ projectId, character: body.character.trim(), meetingId: id });
      return NextResponse.json({ ...r, ...view(projectId) });
    }
    if (body.action === "adopt") {
      adoptDraft(String(body.draftId ?? ""), String(body.by ?? ""));
      return NextResponse.json(view(projectId));
    }
    return NextResponse.json({ error: "action 은 extract | draw | adopt 입니다." }, { status: 400 });
  } catch (e) {
    if (e instanceof CharacterError) {
      const status = e.code === "NO_CHANGE" || e.code === "LIMIT" ? 409 : e.code === "NOT_FOUND" || e.code === "NO_MEETING" ? 404 : 422;
      return NextResponse.json({ code: e.code, error: e.message }, { status });
    }
    if (e instanceof ImageGenError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.code === "QUOTA_EXCEEDED" ? 429 : 502 });
    if (e instanceof LlmError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.code === "NOT_CONFIGURED" ? 503 : 502 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
