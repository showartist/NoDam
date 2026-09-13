import { NextResponse } from "next/server";
import { db, uid, now } from "@/lib/db";
import { analyzeDongSang } from "@/lib/analysis/dongsangAnalyzer";
import { AnalysisError, type AnalysisInputUtterance } from "@/lib/analysis/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Row = { uid: string; speaker_id: string | null; speaker_name: string | null; text_clean: string };

/** POST — 저장된 발언으로 실제 동상이몽 분석을 돌린다. 실패는 실패로 남긴다. */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  const d = db();

  const rows = d
    .prepare(
      `SELECT u.uid,
              u.speaker_id,
              COALESCE(m.display_name, u.speaker_name) AS speaker_name,
              u.text_clean
         FROM utterances u
         LEFT JOIN speaker_mappings m
                ON m.meeting_id = u.meeting_id AND m.speaker_id = u.speaker_id
        WHERE u.meeting_id = ?
        ORDER BY u.idx`,
    )
    .all(meetingId) as Row[];

  if (rows.length === 0) {
    return NextResponse.json(
      { status: "not_run", code: "NO_INPUT", error: "이 회의에 저장된 발언이 없습니다." },
      { status: 422 },
    );
  }

  const input: AnalysisInputUtterance[] = rows.map((r) => ({
    uid: r.uid,
    speakerId: r.speaker_id,
    speakerName: r.speaker_name,
    text: r.text_clean,
  }));

  const runId = uid();
  const ts = now();
  try {
    const result = await analyzeDongSang(input);
    d.prepare(
      `INSERT INTO alignment_analysis_runs
         (id, meeting_id, provider, model, status, error, issues_json, agreements_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      runId, meetingId, result.provider, result.model, "completed", null,
      JSON.stringify(result.issues), JSON.stringify(result.agreements), ts,
    );
    return NextResponse.json({ ...result, runId, utteranceCount: rows.length });
  } catch (e) {
    const err = e instanceof AnalysisError ? e : null;
    const code = err?.code ?? "LLM_FAILED";
    const message = (e as Error).message;
    // 실패도 기록한다. "돌렸는데 아무것도 안 나왔다"와 "실패했다"는 다르다.
    d.prepare(
      `INSERT INTO alignment_analysis_runs
         (id, meeting_id, provider, model, status, error, issues_json, agreements_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(runId, meetingId, "openrouter", "-", "failed", `${code}: ${message}`, null, null, ts);

    return NextResponse.json(
      { status: "failed", code, error: message, runId },
      { status: code === "NOT_CONFIGURED" ? 503 : 502 },
    );
  }
}

/** GET — 마지막 분석 결과. 돌린 적 없으면 not_run. 가짜 결과를 만들지 않는다. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  const row = db()
    .prepare(
      `SELECT * FROM alignment_analysis_runs WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(meetingId) as any;

  if (!row) return NextResponse.json({ status: "not_run", issues: [], agreements: [] });
  if (row.status !== "completed") {
    return NextResponse.json({ status: "failed", error: row.error, issues: [], agreements: [] });
  }
  return NextResponse.json({
    status: "completed",
    provider: row.provider,
    model: row.model,
    issues: JSON.parse(row.issues_json ?? "[]"),
    agreements: JSON.parse(row.agreements_json ?? "[]"),
    createdAt: row.created_at,
  });
}
