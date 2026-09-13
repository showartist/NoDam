import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 상태 규칙 검사 — verify-llm 하니스가 읽는다.
 * 결과 내용은 매번 달라져도 되지만, 이 숫자들은 항상 0이어야 한다.
 */
export async function GET(req: Request) {
  const meetingId = new URL(req.url).searchParams.get("meetingId");
  if (!meetingId) return NextResponse.json({ error: "meetingId 가 필요합니다." }, { status: 400 });

  const d = db();
  const one = <T,>(sql: string) => d.prepare(sql).get(meetingId) as T;

  // AI 가 사람 승인 없이 confirmed 를 만들었는가
  const briefConfirmed = one<{ n: number }>(
    `SELECT COUNT(*) n FROM scene_brief_items
      WHERE meeting_id = ? AND decision_state = 'confirmed' AND approved_at IS NULL`,
  ).n;
  const decisionConfirmed = one<{ n: number }>(
    `SELECT COUNT(*) n FROM decisions
      WHERE meeting_id = ? AND decision_state = 'confirmed' AND approved_at IS NULL`,
  ).n;

  // 커버리지 verified 는 감독 승인으로만 도달해야 한다
  const verifiedWithoutApproval = one<{ n: number }>(
    `SELECT COUNT(*) n FROM shot_coverage
      WHERE meeting_id = ? AND coverage_verification_state = 'verified' AND coverage_approved_at IS NULL`,
  ).n;

  const intents = d
    .prepare(`SELECT id, type, text, evidence FROM scene_intents WHERE meeting_id = ?`)
    .all(meetingId) as unknown as { id: string; type: string; text: string; evidence: string }[];

  const types = intents.map((i) => i.type);
  const duplicateIntentTypes = types.length - new Set(types).size;
  const intentsWithoutEvidence = intents.filter((i) => {
    try {
      return (JSON.parse(i.evidence) as unknown[]).length === 0;
    } catch {
      return true;
    }
  }).length;

  return NextResponse.json({
    meetingId,
    confirmedWithoutApproval: briefConfirmed + decisionConfirmed,
    verifiedWithoutApproval,
    duplicateIntentTypes,
    intentsWithoutEvidence,
    intentTypes: types,
    intentCount: intents.length,
  });
}
