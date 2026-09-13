import type { ProjectVisualWorkspaceModel } from "./types";
import { CollapsibleText, Evidence, IdTag, ViewHeading, VisualImage } from "./ViewSupport";
import { MissingRole, NoEvidence } from "./WorkspaceStates";
import DecisionWriteBar from "./DecisionWriteBar";
import styles from "./projectVisual.module.css";

const roles=[{id:"director",label:"감독"},{id:"cinematographer",label:"촬영"},{id:"art_director",label:"미술"},{id:"producer",label:"제작"},{id:"writer",label:"작가"}] as const;
export default function RoleComparisonView({ model }: { model: ProjectVisualWorkspaceModel }) {
  const question=[...model.decisionQuestions].sort((a,b)=>b.priority-a.priority)[0];
  return <section data-testid="view-comparison"><ViewHeading index="03" title="Role-based Visual Comparison" description="역할별 해석과 인간 결정의 차이를 숨기지 않고 비교합니다." />
    <div className={styles.stickyQuestion}><span>DECISION QUESTION</span><h3>{question?.question??"결정 질문 미등록"}</h3>{question&&<IdTag>{question.id}</IdTag>}</div>
    <div className={styles.roleGrid}>{roles.map(role=>{const ref=model.references.find(r=>r.responsibleRole===role.id||r.responsibleRole===role.label);return ref?<article key={role.id} data-role={role.id}><span>{role.label}</span><VisualImage src={ref.assetUri} alt={`${role.label} 역할 시각 해석`}/><h3>{ref.title}</h3><p>{ref.contentType} · {ref.adoptionLevel}</p><IdTag>{ref.id}</IdTag></article>:<MissingRole key={role.id} role={role.label}/>;})}</div>
    <div className={styles.aiHumanGrid}><article className={styles.aiPanel}><span>AI ANALYSIS · 후보 제안</span><h3>AI는 정리하고, 사람이 선택합니다</h3><CollapsibleText>{model.principles[0]?.currentVersion?.rationale??"저장된 AI 분석 또는 원칙 근거가 없습니다."}</CollapsibleText>{model.principles[0]?.currentVersion?<Evidence values={model.principles[0].currentVersion.evidence}/>:<NoEvidence/>}</article><article className={styles.humanPanel}><span>HUMAN DECISION · 인간 결정</span><h3>{question?.decidedOption??"결정 대기"}</h3><dl><div><dt>결정자</dt><dd>{question?.decidedBy??"미정"}</dd></div><div><dt>결정 시각</dt><dd>{question?.decidedAt??"미정"}</dd></div><div><dt>상태</dt><dd>{question?.state??"open"}</dd></div></dl>{question?<Evidence values={question.evidence}/>:<NoEvidence/>}{question&&<DecisionWriteBar question={question}/>}</article></div>
  </section>;
}
