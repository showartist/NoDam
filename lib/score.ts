import { SceneIssueRow } from "./store";

export type ProductionReadiness = "ready" | "blocked" | "needs_review";

export type ScoreBreakdownItem = {
  id: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low";
  penalty: number;
  reason: string;
};

export type SceneSyncScoreResult = {
  score: number;
  totalPenalty: number;
  readiness: ProductionReadiness;
  readinessNote: string;
  breakdown: ScoreBreakdownItem[];
};

export const SEVERITY_PENALTY: Record<string, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
};

export function calculateSceneSyncScore(
  issues: (SceneIssueRow & { severity?: string; detection_signal?: string; detection_reason?: string })[],
  coverageGapsCount: number = 0,
  unapprovedShotsCount: number = 0,
  pendingBriefCount: number = 0,
): SceneSyncScoreResult {
  const openIssues = issues.filter((i) => i.status === "open");

  const breakdown: ScoreBreakdownItem[] = [];
  let hasCoverageGapIssue = false;

  openIssues.forEach((issue) => {
    if (issue.subject === "shot_coverage") {
      hasCoverageGapIssue = true;
    }

    const sev = (issue.severity || "medium").toLowerCase() as "critical" | "high" | "medium" | "low";
    const penalty = SEVERITY_PENALTY[sev] ?? 5;

    breakdown.push({
      id: issue.issue_id,
      label: `${issue.issue_id} ${issue.subject}`,
      severity: sev,
      penalty,
      reason: issue.detection_reason || issue.question,
    });
  });

  // A-07 이 open 이슈에 없고, 별도의 coverageGap이 존재하는 경우에만 커버리지 갭 감지 감점 (+10)
  if (!hasCoverageGapIssue && coverageGapsCount > 0) {
    breakdown.push({
      id: "COVERAGE_GAP",
      label: "필수 쇼트 누락 (Intent Coverage Gap)",
      severity: "high",
      penalty: 10,
      reason: "Scene Brief의 핵심 의도가 Shot Board에 담기지 않은 갭 감지",
    });
  }

  const totalPenalty = breakdown.reduce((sum, item) => sum + item.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - totalPenalty));

  // Critical 이슈 존재 시 readiness는 무조건 "blocked"
  const hasCriticalBlocked = openIssues.some(
    (i) => (i.severity || "").toLowerCase() === "critical",
  );

  let readiness: ProductionReadiness = "ready";
  let readinessNote = "모든 장면 이슈 및 제작 준비 항목 정렬 완료";

  if (hasCriticalBlocked) {
    readiness = "blocked";
    const criticalIssue = openIssues.find((i) => (i.severity || "").toLowerCase() === "critical");
    readinessNote = `차단됨 (${criticalIssue?.subject || "안전·제작 Critical 이슈 미해결"})`;
  } else if (openIssues.length > 0) {
    readiness = "needs_review";
    readinessNote = `검토 필요 (${openIssues.length}건의 미해결 장면 이슈)`;
  } else if (unapprovedShotsCount > 0 || pendingBriefCount > 0) {
    readiness = "needs_review";
    readinessNote = `검토 필요 (미승인 샷 ${unapprovedShotsCount}건 또는 미승인 Brief ${pendingBriefCount}건 잔여)`;
  }

  return {
    score,
    totalPenalty,
    readiness,
    readinessNote,
    breakdown,
  };
}
