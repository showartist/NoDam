// Shot 최종 승인 가능 여부 판정과 제작 차단 사유 최상단 노출.
// app/m/[id]/Workbench.tsx 가 런타임에 쓴다 — 원래 lib/scene_integrity_contract.test.ts 안에 있었으나
// 프로덕션 코드가 테스트 파일에 있으면 안 되므로 이동.

export function evaluateShotApproval(shot: any, isImageMatchingScene: boolean, isBlocked: boolean): { canApprove: boolean; statusBadge: string; reason?: string } {
  if (!isImageMatchingScene) {
    return { canApprove: false, statusBadge: "⚠️ 레퍼런스 임시 이미지", reason: "장면 콘티 불일치로 인한 승인 불가" };
  }
  if (isBlocked) {
    return { canApprove: false, statusBadge: "🟡 구도 제안 · 제작 검토 중", reason: "제작 차단 조건 미해결" };
  }
  return { canApprove: true, statusBadge: "🟢 최종 승인", reason: "승인 완료" };
}

export function getProductionBlockers(issues: any[]): Array<{ issue_id: string; subject: string; question: string }> {
  return issues
    .filter((i) => i.severity === "critical" || i.signal === "explicit_opposition" || i.signal === "conditional_agree")
    .map((i) => ({ issue_id: i.issue_id, subject: i.subject, question: i.question }));
}
