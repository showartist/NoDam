import type { ProjectVisualWorkspaceModel } from "./types";
import { Evidence, IdTag, ViewHeading, VisualImage } from "./ViewSupport";
import PrincipleApprovalPanel from "./PrincipleApprovalPanel";
import styles from "./projectVisual.module.css";

export default function PrincipleReviewView({ model }: { model: ProjectVisualWorkspaceModel }) {
  const principle=model.principles[0]; const version=principle?.currentVersion;
  const director=principle?.approvals.find(a=>a.role==="director"&&a.status==="active");
  const producer=principle?.approvals.find(a=>a.role==="producer"&&a.status==="active");
  const blocking=[!director&&"감독 active 승인 없음",!producer&&"프로듀서 active 승인 없음"].filter(Boolean) as string[];
  const high=(principle?.sceneIds.length??0)+(principle?.shotIds.length??0);
  const unknown=version&&!version.evidence.length?1:0;
  const refs=model.references.filter(ref=>version?.evidence.some(item=>typeof item==="string"&&item===ref.id)).slice(0,3);
  return <section data-testid="view-principles"><ViewHeading index="04" title="Visual Principle Review" description="Production Check와 공동 승인을 버전 단위로 검토합니다." />
    {!principle?<div className={styles.inlineEmpty}>검토할 Visual Principle이 없습니다.</div>:<div className={styles.principleLayout}><aside>{model.principles.map(item=><div className={item.id===principle.id?styles.selectedPrinciple:""} key={item.id}><b>{item.title}</b><span>{item.status}</span><IdTag>{item.id}</IdTag></div>)}</aside><article className={styles.principleDetail} data-principle-id={principle.id} data-version-id={version?.id??"none"}>
      <div className={styles.principleTitle}><div><span>{principle.status}</span><h3>{principle.title}</h3></div><div><small>current version</small><strong>{version?`v${version.versionNumber}`:"미등록"}</strong></div></div><p className={styles.principleStatement}>{version?.principleText??"현재 버전 문구가 없습니다."}</p>{version&&<><IdTag>{version.id}</IdTag><Evidence values={version.evidence}/></>}
      {!!refs.length&&<div className={styles.evidenceThumbs}>{refs.map(ref=><figure key={ref.id}><VisualImage src={ref.assetUri} alt={`${ref.title} 원칙 근거`}/><figcaption>{ref.title}</figcaption></figure>)}</div>}
      <div className={styles.checkGrid}><article data-check="blocking"><b>BLOCKING · {blocking.length}</b><p>{blocking.join(" · ")||"없음"}</p></article><article data-check="high"><b>HIGH · {high}</b><p>{high?"연결된 Scene/Shot 제작 영향 확인 필요":"없음"}</p></article><article data-check="unknown"><b>UNKNOWN · {unknown}</b><p>{unknown?"근거 U-ID 확인 필요":"없음"}</p></article><article data-check="checked"><b>CHECKED · {director&&producer?2:0}/2</b><p>감독 {director?"완료":"대기"} · 제작 {producer?"완료":"대기"}</p></article></div>
      <div className={styles.approvalBar}><div><span>최초 승인</span><strong>{version?.versionNumber===1?"기준 버전 등록 대상":"기존 버전"}</strong></div><div><span>버전 수정 전파</span><strong>{version&&version.versionNumber>1?"명시적 링크만 재검토":"해당 없음"}</strong></div></div>
      <PrincipleApprovalPanel principle={principle} blocked={blocking.length>0} blockingReasons={blocking}/>
    </article></div>}
  </section>;
}
