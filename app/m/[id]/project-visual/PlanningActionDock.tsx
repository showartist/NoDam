import styles from "./projectVisual.module.css";
const actions=["확인 완료","문제 있음","사진 추가","감독 확인 요청","촬영 보류","Shot 완료"];
export default function PlanningActionDock(){return <section className={styles.actionDock} aria-label="향후 현장 액션"><span>ON-SET ACTION BOUNDARY</span><div>{actions.map(action=><button key={action} disabled title="Phase 8 이후 On-Set Mode에서 활성화">{action}</button>)}</div><small>현재는 읽기 전용입니다. 성공 상태를 가장하지 않습니다.</small></section>}
