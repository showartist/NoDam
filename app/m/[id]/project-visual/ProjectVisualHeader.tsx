import type { ProjectVisualWorkspaceModel, ViewId } from "./types";
import { VIEW_ITEMS } from "./types";
import styles from "./projectVisual.module.css";

export default function ProjectVisualHeader({ model, view }: { model: ProjectVisualWorkspaceModel; view: ViewId }) {
  const question = [...model.decisionQuestions].filter(q=>q.state!=="decided").sort((a,b)=>b.priority-a.priority)[0];
  const reviewCount = model.scenes.filter(s=>s.reviewStatus==="review_required").length + model.shots.filter(s=>s.status==="restale").length;
  return <header className={styles.workspaceHeader}>
    <div><span className={styles.eyebrow}>동상이몽 · Planning Mode</span><h1>{model.project.title}</h1><p>{VIEW_ITEMS.find(item=>item.id===view)?.label} · {model.project.status}</p></div>
    <div className={styles.headerMetrics}><span><b>{model.decisionQuestions.filter(q=>q.state!=="decided").length}</b> 미결정</span><span><b>{reviewCount}</b> 재검토</span></div>
    <div className={styles.priorityQuestion}><span>최우선 결정 질문</span><strong>{question?.question ?? "열린 결정 질문이 없습니다"}</strong>{question&&<code>{question.id} · {question.state}</code>}</div>
  </header>;
}
