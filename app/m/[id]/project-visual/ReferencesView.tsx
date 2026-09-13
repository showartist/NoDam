import type { ProjectVisualWorkspaceModel } from "./types";
import { textList } from "./types";
import { Evidence, IdTag, ViewHeading, VisualImage } from "./ViewSupport";
import { ReferenceCreateBar, ReferenceRowActions } from "./ReferenceWriteBar";
import styles from "./projectVisual.module.css";

export default function ReferencesView({ model }: { model: ProjectVisualWorkspaceModel }) {
  return <section data-testid="view-references"><ViewHeading index="02" title="Visual Reference Library" description="Shot Recipe가 참조할 승인 입력 자산입니다. Recipe 자체는 포함하지 않습니다." />
    <ReferenceCreateBar/>
    {!model.references.length ? <div className={styles.inlineEmpty}>Reference가 없습니다. 위에서 등록할 수 있습니다.</div> : <div className={styles.referenceGrid}>{model.references.map(ref=><article className={styles.referenceCard} key={ref.id} data-reference-id={ref.id}>
      <div className={styles.referenceImage}><VisualImage src={ref.assetUri} alt={`${ref.title} 시각 레퍼런스`}/><span>{ref.referenceImageState}</span></div>
      <div className={styles.cardBody}><div className={styles.cardTitle}><div><small>{ref.contentType}</small><h3>{ref.title}</h3></div><b data-level={ref.adoptionLevel}>{ref.adoptionLevel}</b></div><IdTag>{ref.id}</IdTag>
      <div className={styles.takeDropMini}><p><b>TAKE</b>{textList(ref.take).join(" · ")||"미등록"}</p><p><b>DROP</b>{textList(ref.drop).join(" · ")||"미등록"}</p></div>
      <dl><div><dt>Scene links</dt><dd>{ref.sceneIds.length?ref.sceneIds.map(id=><code key={id}>{id}</code>):"연결 없음"}</dd></div><div><dt>책임 역할</dt><dd>{ref.responsibleRole||"Missing role"}</dd></div><div><dt>출처 · 버전</dt><dd>{ref.sourceMethod} · {ref.versionLabel}</dd></div></dl><Evidence values={ref.evidence}/>
      <ReferenceRowActions reference={ref} scenes={model.scenes}/></div>
    </article>)}</div>}
    <aside className={styles.exampleNote}>상태 예시 카드(Loading/Error/Empty)는 실제 Reference 데이터와 분리된 UI 계약이며 구현 단계에서 데이터 목록에 혼합하지 않습니다.</aside>
  </section>;
}
