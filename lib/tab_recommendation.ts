// 진행 상태별 Workbench 초기 탭 추천. app/m/[id]/Workbench.tsx 가 런타임에 쓴다 —
// 원래 lib/ui_render_contract.test.ts 안에 있었으나 프로덕션 코드가 테스트 파일에 있으면 안 되므로 이동.
export function getRecommendedInitialTab(shots: any[], briefItems: any[], unresolved: any[]): string {
  const approvedShots = shots.filter((s) => s.status === "approved").length;
  const approvedBrief = briefItems.filter((b) => b.verification_state === "approved").length;

  if (approvedShots >= 3) return "shotboard"; // 콘티 승인 완료 ➔ Shot Board 중심
  if (approvedBrief >= 5) return "brief";     // Brief 승인 단계 ➔ Scene Brief 중심
  if (unresolved.length > 0) return "issues"; // 이슈 존재 ➔ Scene Issues 중심
  return "transcript";                       // 신규/추출 전 ➔ Transcript 중심
}
