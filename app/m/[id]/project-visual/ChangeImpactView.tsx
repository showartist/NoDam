import type { ProjectVisualWorkspaceModel } from "./types";
import { IdTag, ViewHeading, VisualImage } from "./ViewSupport";
import { LegacyUnknown, ReadOnlyAction } from "./WorkspaceStates";
import styles from "./projectVisual.module.css";

const meta={affected:{icon:"!",label:"영향 있음",description:"명시적 링크와 변경 범위가 일치해 재검토 또는 상태 확인이 필요합니다."},unaffected:{icon:"✓",label:"영향 없음",description:"명시적 범위를 검토했으며 이번 변경과 무관한 대상으로 기록했습니다."},unknown:{icon:"?",label:"판단 불가",description:"legacy 링크가 부족해 시스템이 추정하지 않고 인간 검토를 요청합니다."}} as const;
const statusLabel={review_required:"다시 확인 필요",restale:"승인 후 내용 변경됨"} as const;
export default function ChangeImpactView({ model }: { model: ProjectVisualWorkspaceModel }) {
  return <section data-testid="view-impact"><ViewHeading index="06" title="Change Impact & Decision Lineage" description="영향·무관·판단 불가를 모두 기록하고 후속 행동을 분리합니다." />
    <div className={styles.impactGrid}>{(["affected","unaffected","unknown"] as const).map(result=>{const impacts=model.cascadeImpacts.filter(i=>i.impactResult===result);return <article key={result} data-impact-result={result}><header><span>{meta[result].icon}</span><div><small>{result}</small><h3>{meta[result].label} · {impacts.length}</h3></div></header><p>{meta[result].description}</p>{!impacts.length?<div className={styles.impactEmpty}>해당 결과 없음</div>:impacts.map(impact=>{const shot=model.shots.find(s=>s.id===impact.targetId);const scene=model.scenes.find(s=>s.id===impact.targetId);return <div className={styles.impactItem} key={impact.id} data-impact-id={impact.id}><div>{shot?.imageUri&&<VisualImage src={shot.imageUri} alt={`${impact.targetType} ${impact.targetId} 미리보기`}/>}<strong>{impact.targetType.toUpperCase()} · {scene?`SCENE ${scene.sceneNumber}`:shot?`SHOT ${shot.shotNumber}`:impact.targetId}</strong></div><IdTag>{impact.targetId}</IdTag><p>{impact.reason}</p><dl><div><dt>상태 전환</dt><dd>{impact.targetNewStatus?statusLabel[impact.targetNewStatus]:"상태 유지"}</dd></div><div><dt>원칙 버전</dt><dd><IdTag>{impact.principleVersionId}</IdTag></dd></div><div><dt>변경 유형</dt><dd>{impact.changeType}</dd></div></dl>{result==="unknown"&&<><LegacyUnknown/><ReadOnlyAction>링크 확인 · 인간 검토</ReadOnlyAction></>}</div>})}</article>})}</div>
    <div className={styles.lineage}><h3>Decision Lineage</h3>{model.decisionLineage.length?model.decisionLineage.map(item=><div key={item.id} data-lineage-id={item.id}><IdTag>{item.sourceId}</IdTag><span>{item.relation} →</span><IdTag>{item.targetId}</IdTag><small>{item.evidenceUid??"근거 U-ID 없음"}</small></div>):<p>기록된 결정 계보가 없습니다.</p>}</div>
  </section>;
}
