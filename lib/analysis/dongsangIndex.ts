import type { AlignmentIssueV2 } from "../alignment/schema";
import { normalizeForMatch } from "../alignment/checks";

/** @deprecated 과거 호환성 테스트 전용. UI/API의 회의 점수로 사용 금지.
 * 잠정 v1: 검증된 활성 안건의 항목·화자 쌍을 동일 가중치로 비교한다. 추가 LLM 호출 없음. */
export const INDEX_THRESHOLDS = { review: 30, alert: 60 } as const;
export type DongsangIndex = {
  version: "pair-distance-v1"; score: number | null;
  compared: number; different: number; unknown: number; coverage: number | null;
  level: "insufficient" | "low" | "review" | "alert";
};
export function countReviewedPairs(issues: AlignmentIssueV2[]) {
  const comparisons = new Map<string, "same" | "different" | "unclear">();
  for (const issue of issues) {
    if (issue.state === "resolved" || issue.state === "dismissed" || issue.type === "past_decision_conflict") continue;
    const supported = new Set(issue.positions.filter(p =>
      p.speaker.key && p.evidence.length && p.checks.speaker === "ok" &&
      p.checks.quote === "ok" && p.checks.context === "supported"
    ).map(p => p.speaker.key!));
    for (const slot of issue.slot_diff) {
      const keys = Object.keys(slot.values).sort();
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i], b = keys[j];
        const pair = slot.pairs?.find(p => (p.a === a && p.b === b) || (p.a === b && p.b === a));
        let verdict = pair?.verdict ?? (normalizeForMatch(slot.values[a]) === normalizeForMatch(slot.values[b]) ? "same" : "unclear");
        if (!supported.has(a) || !supported.has(b)) verdict = "unclear";
        // 반복 창/중복 안건은 같은 증거·항목·화자 쌍으로 한 번만 센다.
        const evidence = issue.positions.filter(p => p.speaker.key === a || p.speaker.key === b).flatMap(p => p.evidence);
        const key = JSON.stringify([issue.meeting_id, [...new Set(evidence)].sort(), slot.slots ?? [slot.slot], a, b]);
        const prev = comparisons.get(key);
        comparisons.set(key, prev && prev !== verdict ? "unclear" : verdict);
      }
    }
  }
  const values = [...comparisons.values()];
  const different = values.filter(v => v === "different").length;
  const unknown = values.filter(v => v === "unclear").length;
  const compared = values.length - unknown;
  return { compared, different, unknown, coverage: values.length ? Math.round(1000 * compared / values.length) / 10 : null };
}
/** @deprecated 이전 계산의 회귀 확인용. 제품에서는 countReviewedPairs만 사용한다. */
export function calculateDongsangIndex(issues: AlignmentIssueV2[]): DongsangIndex {
  const counts = countReviewedPairs(issues), { compared, different } = counts;
  const score = compared ? Math.round(1000 * different / compared) / 10 : null;
  return { ...counts, version: "pair-distance-v1", score,
    level: score === null ? "insufficient" : score >= INDEX_THRESHOLDS.alert ? "alert" : score >= INDEX_THRESHOLDS.review ? "review" : "low" };
}
