import type { ProjectVisualWorkspaceModel } from "./types";
import styles from "./projectVisual.module.css";

export default function ProjectVisualQuickSummary({ model }: { model: ProjectVisualWorkspaceModel }) {
  const approvalBlocked=model.principles.filter(principle=>{
    const active=principle.approvals.filter(approval=>approval.status==="active");
    return !active.some(approval=>approval.role==="director")||!active.some(approval=>approval.role==="producer");
  }).length;
  const undecided=model.decisionQuestions.filter(question=>question.state!=="decided").length;
  const approvalPending=model.principles.filter(principle=>principle.status==="candidate"||principle.status==="needs_review").length;
  const reviewTargets=model.scenes.filter(scene=>scene.reviewStatus==="review_required").length+model.shots.filter(shot=>shot.status==="restale").length;
  const linkedScenes=new Set([...model.references.flatMap(ref=>ref.sceneIds),...model.principles.flatMap(principle=>principle.sceneIds),...model.characterVisuals.flatMap(character=>character.sceneIds)]).size;
  const items=[{label:"촬영 전 해결",value:approvalBlocked,tone:"blocking"},{label:"미확정 결정",value:undecided,tone:"pending"},{label:"승인 대기",value:approvalPending,tone:"pending"},{label:"다시 확인",value:reviewTargets,tone:"review"},{label:"연결 Scene",value:linkedScenes,tone:"linked"}];
  return <section className={styles.quickSummary} aria-label="현장 Quick Summary" data-testid="quick-summary"><header><strong>QUICK VIEW</strong><span>Planning Mode 요약 · 현장에서는 행동 항목부터 확인</span></header><div>{items.map(item=><article key={item.label} data-tone={item.tone}><b>{item.value}</b><span>{item.label}</span></article>)}</div></section>;
}
