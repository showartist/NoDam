import type { AlignmentIssueV2 } from "../alignment/schema";
import { countReviewedPairs } from "./dongsangIndex";

/** B안: 탐지된 안건의 검수 현황. 회의 전체 갈등률·정밀도·위험 점수가 아니다. */
export function summarizeAlignmentReview(issues: AlignmentIssueV2[]) {
  const active = issues.filter(i => i.state !== "resolved" && i.state !== "dismissed");
  const counts = countReviewedPairs(active);
  return {
    pendingIssues: active.length,
    compared: counts.compared,
    different: counts.different,
    same: counts.compared - counts.different,
    unknown: counts.unknown,
    coverage: counts.coverage,
  };
}
export type AlignmentReviewSummary = ReturnType<typeof summarizeAlignmentReview>;
