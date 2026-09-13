// Project Development 모드의 Character Bible 상태 분류, Project Issue 파급 영향 범위,
// Scene Brief 4단계 세분화 상태 분류. app/m/[id]/Workbench.tsx 가 런타임에 쓴다 — 원래
// lib/project_dev_integrity_contract.test.ts 안에 있었으나 프로덕션 코드가 테스트 파일에 있으면
// 안 되므로 이동. (필드/이슈 ID 별 하드코딩 stub — projectDevData 값 자체를 읽지는 않는다.)

export function evaluateCharacterFieldState(field: string): { state: string; approver: string; evidence: string } {
  if (field === "external_goal" || field === "wound") {
    return { state: "confirmed", approver: "작가 최은서", evidence: "U12" };
  }
  if (field === "arc" || field === "internal_need") {
    return { state: "provisional", approver: "감독 박재인", evidence: "U27" };
  }
  return { state: "review_required", approver: "미정", evidence: "U04" };
}

export function getProjectIssueImpact(issueId: string): { impactScope: string[]; linkedScenes: string[] } {
  if (issueId === "P-01") {
    return {
      impactScope: ["Character.wound", "ProjectBible.logline"],
      linkedScenes: ["SCENE 12", "SCENE 34"],
    };
  }
  return { impactScope: ["VisualPrinciple"], linkedScenes: ["SCENE 34"] };
}

export function classifyBriefState(field: string): { state: string; label: string; bg: string } {
  if (field === "SCENE_NUMBER" || field === "INT_EXT" || field === "LOCATION" || field === "TIME_OF_DAY" || field === "CHARACTERS") {
    return { state: "confirmed", label: "🟢 확정", bg: "#166534" };
  }
  if (field === "LENS_TONE" || field === "ENDING_IMAGE_WAY") {
    return { state: "provisional", label: "🟡 잠정", bg: "#854d0e" };
  }
  if (field === "SAFETY_CONSTRAINTS" || field === "CRANE_ENTRY") {
    return { state: "blocked", label: "🔴 제작 차단", bg: "#991b1b" };
  }
  return { state: "review_required", label: "⚪ 검토 필요", bg: "#374151" };
}
