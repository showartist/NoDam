"use client";
import {useEffect,useState} from "react";
import type {CommandInput,Participant,Question} from "@/lib/meetingDecisions/model";
import s from "./decisions.module.css";
const relations={same:"같은 뜻",complementary:"서로 보완하는 생각",choice:"선택이 필요한 의견 차이",unresolved:"아직 미확인"};
type Props={question:Question;participants:Participant[];busy:boolean;send:(command:CommandInput)=>Promise<boolean>;onUseConditions:(value:string)=>void};
export function InterpretationCard({question:q,participants,busy,send,onUseConditions}:Props){
 const c=q.comparison;
 const [expression,setExpression]=useState(c?.expression??""),[target,setTarget]=useState(c?.decisionTarget??"");
 const [person,setPerson]=useState(participants[0]?.id??""),[meaning,setMeaning]=useState(""),[example,setExample]=useState(""),[conditions,setConditions]=useState(""),[checked,setChecked]=useState(false);
 const [relation,setRelation]=useState<keyof typeof relations>(c?.synthesis?.relation??"unresolved"),[shared,setShared]=useState(c?.synthesis?.sharedConditions??""),[differences,setDifferences]=useState(c?.synthesis?.remainingDifferences??"");
 const saved=c?.interpretations.find(i=>i.participantId===person);
 useEffect(()=>{setMeaning(saved?.meaning??"");setExample(saved?.example??"");setConditions(saved?.conditions??"");setChecked(false);},[person,saved,c?.expression]);
 useEffect(()=>{setRelation(c?.synthesis?.relation??"unresolved");setShared(c?.synthesis?.sharedConditions??"");setDifferences(c?.synthesis?.remainingDifferences??"");},[c?.synthesis]);
 useEffect(()=>{setExpression(c?.expression??"");setTarget(c?.decisionTarget??"");},[c?.expression,c?.decisionTarget]);
 const roster=q.confirmedAt?q.participantsAtConfirmation:participants;
 const missing=roster.filter(p=>!c?.interpretations.some(i=>i.participantId===p.id&&i.confirmedByParticipant));
 const canSynthesize=roster.length>0&&missing.length===0;
 function resetConfirmation(){setChecked(false);}
 const setup=<form onSubmit={async e=>{e.preventDefault();await send({action:"comparison",questionId:q.id,expression,decisionTarget:target});}}>
  <label>비교할 원문 표현<input aria-label="비교할 원문 표현" value={expression} onChange={e=>setExpression(e.target.value)} maxLength={200} disabled={busy} required placeholder="예: 따뜻한 · 간단한 · 세련된"/></label>
  <label>이번에 구체적으로 결정할 것<textarea aria-label="이번에 구체적으로 결정할 것" value={target} onChange={e=>setTarget(e.target.value)} maxLength={500} disabled={busy} required placeholder="예: 가족 장면에서 사용할 행동과 조명의 조건"/></label>
  <p className={s.muted}>이 안건에 연결된 원문에 실제로 있는 표현을 입력하세요.{c&&" 표현이나 결정 대상을 바꾸면 해석·정리·진행 동의를 다시 확인합니다. 이전 기록은 변경 이력에 남습니다."}</p>
  <button disabled={busy}>{c?"비교 대상 변경 · 다시 확인":"해석 비교 시작"}</button>
 </form>;
 return <section className={s.card} aria-label="해석 비교 카드">
  <span className={s.eyebrow}>같은 말, 각자의 그림</span><h3>해석 비교 카드</h3>
  <p className={s.muted}>AI 후보나 원문에서 출발해 각자가 뜻을 확인합니다. 다른 뜻이 함께 성립할 수도 있습니다. 진행자가 본인에게 확인한 내용을 기록하며, AI가 속뜻이나 합의를 확정하지 않습니다.</p>
  {!c?(!q.confirmedAt&&setup):<>
   <h4>“{c.expression}” — {c.decisionTarget}</h4>
   <p className={s.notice}>여기서 “{c.expression}”은 어떤 뜻인가요? 구체적인 예와 실행 조건을 각자 설명해 주세요. 여러 뜻이 함께 성립할 수도 있습니다.</p>
   <p role="status">본인 해석 확인 {roster.length-missing.length}/{roster.length}명 · {missing.length?`미확인: ${missing.map(p=>p.name).join(", ")}`:"아래 정리와 결정안에 대한 진행 동의는 별도로 확인합니다."}</p>
   <div className={s.interpretations}>{roster.map(p=>{const i=c.interpretations.find(i=>i.participantId===p.id);return <article className={s.interpretation} key={p.id}><h4>{p.name}{p.role&&` · ${p.role}`}</h4><p className={s.muted}>{i?"본인에게 확인한 해석 · 진행자 기록":"아직 본인 해석 미확인"}</p><dl><dt>뜻</dt><dd>{i?.meaning||"미확인"}</dd><dt>구체적인 예</dt><dd>{i?.example||"미확인 · 어떤 모습을 예로 들 수 있나요?"}</dd><dt>실행 조건</dt><dd>{i?.conditions||"미확인 · 무엇을 확인하면 구현됐다고 볼 수 있나요?"}</dd></dl></article>;})}</div>
   {!q.confirmedAt&&<details open><summary>각자의 해석 확인하기</summary><form onSubmit={async e=>{e.preventDefault();if(!checked)return;if(await send({action:"interpretation",questionId:q.id,participantId:person,meaning,example,conditions,confirmedByParticipant:true}))setChecked(false);}}>
    <label>해석을 확인할 참가자<select aria-label="해석을 확인할 참가자" value={person} onChange={e=>setPerson(e.target.value)} disabled={busy} required><option value="" disabled>참가자 선택</option>{participants.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
    <label>이 표현으로 뜻한 것<textarea aria-label="이 표현으로 뜻한 것" value={meaning} onChange={e=>{setMeaning(e.target.value);resetConfirmation();}} maxLength={1000} required disabled={busy}/></label>
    <label>구체적인 예 · 모르면 비워 두기<textarea aria-label="구체적인 예" value={example} onChange={e=>{setExample(e.target.value);resetConfirmation();}} maxLength={1000} disabled={busy}/></label>
    <label>실행 조건 · 모르면 비워 두기<textarea aria-label="해석의 실행 조건" value={conditions} onChange={e=>{setConditions(e.target.value);resetConfirmation();}} maxLength={1000} disabled={busy}/></label>
    <label className={s.check}><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)} disabled={busy} required/>이 내용을 해당 참가자 본인에게 확인했습니다.</label>
    <button disabled={busy||!checked||!person}>본인 해석 기록</button>
   </form></details>}
   <h4>뜻의 관계와 함께 확인할 조건</h4>
   {c.synthesis?<div className={s.notice}><strong>{relations[c.synthesis.relation]}</strong><p>{c.synthesis.sharedConditions}</p><p>남은 차이·처리 방향: {c.synthesis.remainingDifferences||"기록된 차이 없음 · 모든 생각이 같다는 뜻은 아닙니다."}</p><p className={s.muted}>{q.confirmedAt?"이 조건과 남은 차이를 포함해 진행 동의를 기록했습니다.":"사람이 정리한 결정안 후보입니다. 참가자의 진행 동의를 아직 확정하지 않았습니다."}</p></div>:<p className={s.muted}>정리 미완료 · 미응답이나 침묵을 같은 뜻으로 처리하지 않습니다.</p>}
   {!q.confirmedAt&&<><form onSubmit={async e=>{e.preventDefault();await send({action:"synthesis",questionId:q.id,relation,sharedConditions:shared,remainingDifferences:differences});}}>
    <label>해석 사이의 관계<select aria-label="해석 사이의 관계" value={relation} onChange={e=>setRelation(e.target.value as typeof relation)} disabled={busy}>{Object.entries(relations).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    <label>함께 확인할 구체적 조건<textarea aria-label="함께 확인할 구체적 조건" value={shared} onChange={e=>setShared(e.target.value)} maxLength={1500} required disabled={busy} placeholder="예: 인물이 서로 챙기는 행동을 중심으로 하고, 얼굴이 보이는 조명을 사용한다."/></label>
    <label>남은 차이와 처리 방향<textarea aria-label="남은 차이와 처리 방향" value={differences} onChange={e=>setDifferences(e.target.value)} maxLength={1000} required={relation==="choice"||relation==="unresolved"} disabled={busy} placeholder="의견 차이를 지우지 말고, 어떤 선택이나 추가 확인을 할지 기록합니다."/></label>
    <button disabled={busy||!canSynthesize}>비교 정리 저장 · 진행 동의 다시 받기</button>
   </form>{!canSynthesize&&<p className={s.muted}>참가자 전원의 해석을 본인에게 확인해야 정리를 저장할 수 있습니다.</p>}
   {c.synthesis&&c.synthesis.relation!=="unresolved"&&<button disabled={busy} onClick={()=>onUseConditions(c.synthesis!.sharedConditions)}>이 조건을 결정안 초안에 가져오기</button>}
   <details><summary>비교할 표현·결정 대상 변경</summary>{setup}</details></>}
  </>}
 </section>;
}
