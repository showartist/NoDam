import type { ProjectVisualWorkspaceModel } from "./types";
import { textList } from "./types";
import { Evidence, IdTag, ViewHeading, VisualImage } from "./ViewSupport";
import styles from "./projectVisual.module.css";

export default function CharacterBibleView({ model }: { model: ProjectVisualWorkspaceModel }) {
  const character=model.characterVisuals[0];
  const cells=character?[{key:"face",label:"Face Master",src:character.faceAssetUri},{key:"costume",label:"Costume Master",src:character.costumeAssetUri},{key:"fullbody",label:"Full-body",src:character.fullbodyAssetUri},{key:"inspace",label:"In-space",src:character.inspaceAssetUri},{key:"prop",label:"Key Object",src:character.propAssetUri}]:[];
  return <section data-testid="view-characters"><ViewHeading index="05" title="Character Visual Bible" description="인물의 얼굴·의상·전신·공간·소품을 하나의 버전으로 잠급니다." />
    {!character?<div className={styles.inlineEmpty}>Character Visual Bible이 없습니다.</div>:<div className={styles.characterLayout} data-character-id={character.characterId} data-character-version-id={character.id}><div className={styles.characterImages}>{cells.map(cell=><figure key={cell.key} data-aspect={cell.key}><VisualImage src={cell.src} alt={`${character.characterName} ${cell.label}`}/><figcaption><span>{cell.label}</span><small>{cell.src?"asset linked":"not uploaded"}</small></figcaption></figure>)}</div><aside className={styles.characterRules}><div><small>CHARACTER / VERSION</small><h3>{character.characterName}</h3><IdTag>{character.characterId}</IdTag><IdTag>{character.id} · v{character.versionNumber}</IdTag></div><article><b>Continuity Lock</b><p>{Object.keys(character.continuityLock).length?JSON.stringify(character.continuityLock):"잠금 조건 미등록"}</p></article><article><b>Allowed</b><p>{textList(character.allowed).join(" · ")||"미등록"}</p></article><article><b>Prohibited</b><p>{textList(character.prohibited).join(" · ")||"미등록"}</p></article><Evidence values={character.evidence}/></aside></div>}
    {character&&<div className={styles.sceneVariations}><span>SCENE VARIATION</span>{character.sceneIds.length?character.sceneIds.map(sceneId=><div key={sceneId}><IdTag>{sceneId}</IdTag><p>해당 Scene 변형은 이 Character ID와 Version ID를 기준으로 검토합니다.</p></div>):<p>연결 Scene 없음</p>}</div>}
  </section>;
}
