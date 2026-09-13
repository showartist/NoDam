import type { ProjectVisualWorkspaceModel } from "./types";
import { textList } from "./types";
import { CollapsibleText, Evidence, IdTag, ViewHeading, VisualImage } from "./ViewSupport";
import styles from "./projectVisual.module.css";

export default function VisualSpineView({ model }: { model: ProjectVisualWorkspaceModel }) {
  const hero = model.references.find(r=>r.adoptionLevel==="core"&&r.assetUri) ?? model.references.find(r=>r.assetUri);
  const support = model.references.find(r=>r.id!==hero?.id&&r.assetUri);
  const principle = model.principles.find(p=>p.status==="confirmed") ?? model.principles[0];
  const question = [...model.decisionQuestions].filter(q=>q.state!=="decided").sort((a,b)=>b.priority-a.priority)[0];
  const reviewScenes = model.scenes.filter(s=>s.reviewStatus==="review_required");
  const reviewShots = model.shots.filter(s=>s.status==="restale");
  return <section data-testid="view-spine"><ViewHeading index="01" title="Project Core Visual Spine" description="작품의 시각적 약속과 제작 현실을 같은 프레임에서 확인합니다." />
    <div className={styles.heroGrid}>
      <figure className={styles.hero}><VisualImage src={hero?.assetUri??null} alt={hero?.title??"Project Visual Hero"}/><figcaption><span>HERO REFERENCE</span><h3>{hero?.title??"Core Reference 미등록"}</h3>{hero&&<IdTag>{hero.id}</IdTag>}</figcaption></figure>
      <div className={styles.supportColumn}><figure><VisualImage src={support?.assetUri??null} alt={support?.title??"보조 인물 Reference"}/><figcaption>{support?.title??"보조 Reference 미등록"}</figcaption></figure><div className={styles.negativeCard}><span>NEGATIVE REFERENCE</span><strong>금지 요소는 승인된 Drop 데이터만 사용</strong><p>{hero?textList(hero.drop).slice(0,3).join(" · ")||"Drop 미등록":"Reference 미등록"}</p></div></div>
    </div>
    <div className={styles.decisionBanner}><span>지금 결정할 것</span><h3>{question?.question??"열린 결정 질문이 없습니다"}</h3>{question&&<><IdTag>{question.id}</IdTag><Evidence values={question.evidence}/></>}</div>
    <div className={styles.intentReality}><article><span>CREATIVE INTENT</span><h3>{principle?.title??"Visual Principle 미등록"}</h3><CollapsibleText>{principle?.currentVersion?.principleText??"확정 또는 검토 중인 시각 원칙이 없습니다."}</CollapsibleText>{principle?.currentVersion&&<IdTag>{principle.currentVersion.id}</IdTag>}</article><article><span>PRODUCTION REALITY</span><h3>{reviewScenes.length} Scene · {reviewShots.length} Shot 다시 확인</h3><CollapsibleText>{[...reviewScenes.slice(0,2).map(s=>`SCENE ${s.sceneNumber}`),...reviewShots.slice(0,2).map(s=>`SHOT ${s.shotNumber} · 승인 후 내용 변경됨`)].join(" · ")||"현재 다시 확인할 대상 없음"}</CollapsibleText></article></div>
    <div className={styles.takeDrop}><article><b>TAKE</b><p>{hero?textList(hero.take).slice(0,4).join(" · ")||"Take 미등록":"Reference 미등록"}</p></article><article><b>DROP</b><p>{hero?textList(hero.drop).slice(0,4).join(" · ")||"Drop 미등록":"Reference 미등록"}</p></article><article><b>TOP CONSTRAINTS</b><p>{model.cascadeImpacts.filter(i=>i.impactResult!=="unaffected").slice(0,3).map(i=>i.reason).join(" · ")||"등록된 영향 제약 없음"}</p></article></div>
  </section>;
}
