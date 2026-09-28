"use client";
import {useState} from "react";
import type {StoredReview} from "@/lib/facilitator/store";
import s from "../alignment/v2/v2.module.css";
export type FacilitatorState={goal:string;intervalMinutes:number;processedMs:number;error:string|null;reviews:StoredReview[]};
const label={topic_drift:"주제 흐름",meaning_gap:"해석 차이",inconsistency:"앞선 발언과의 불일치"};
const time=(ms:number)=>`${String(Math.floor(ms/60000)).padStart(2,"0")}:${String(Math.floor(ms%60000/1000)).padStart(2,"0")}`;
export function FacilitatorPanel({state,meetingId,decisionsHref,onQuestion}:{state:FacilitatorState|null;meetingId:string;decisionsHref?:string;onQuestion?:(id:string)=>void}){
 const [chosen,setChosen]=useState<number|null>(null);
 const [error,setError]=useState("");
 const [saving,setSaving]=useState(false);
 async function importFinding(reviewId:number,findingIndex:number){
  if(saving)return;setSaving(true);setError("");
  try{const endpoint=`/api/meetings/${meetingId}/decisions`;const snapshot=await fetch(endpoint);const board=await snapshot.json();if(!snapshot.ok)throw new Error(board.error);
   const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({revision:board.revision,command:{action:"import",reviewId,findingIndex}})});const j=await r.json();if(!r.ok)throw new Error(j.error);const saved=j.questions.find((q:{source:{reviewId:number;findingIndex:number}|null})=>q.source?.reviewId===reviewId&&q.source.findingIndex===findingIndex);if(saved&&onQuestion){onQuestion(saved.id);return;}window.location.href=`${decisionsHref??`/m/${meetingId}/decisions`}${saved?`?question=${encodeURIComponent(saved.id)}`:""}`;
  }catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }
 if(!state)return <section className={s.detail}><h2>회의 진행 보조</h2><p>회의 목적을 입력하고 시작하면 최근 대화를 정해진 주기로 확인합니다.</p></section>;
 const latest=state.reviews.at(-1),selected=state.reviews.find(r=>r.id===chosen)??latest;
 return <section className={s.detail} aria-label="회의 진행 보조 결과">
  <h2 style={{marginTop:0}}>회의 진행 보조</h2>
  {error&&<p role="alert" className={s.error}>{error}</p>}
  <p><strong>고정된 회의 목적</strong><br/>{state.goal}</p>
  <p className={s.muted}>{state.intervalMinutes}분 관찰 · 검토 {state.reviews.length}회 · 점수 없이 원문 근거로 확인합니다.</p>
  {state.error&&<div className={s.error}>최근 분석 실패. 해당 구간을 성공으로 처리하지 않았습니다. {state.error.slice(0,200)}</div>}
  {latest?.assessed.notification&&!latest.sourceChanged&&<div role="status" style={{padding:16,background:"#eff6ff",border:"1px solid #93c5fd",borderRadius:10,marginBottom:14}}><strong>{time(latest.toMs)} · 확인 제안</strong><p>{latest.assessed.notification.question}</p></div>}
  {!selected?<p>전사는 계속 들어오고 있습니다. {state.intervalMinutes}분이 쌓이면 첫 검토를 진행합니다. 정상 흐름이면 별도 알림을 보내지 않습니다.</p>:<>
   <nav aria-label="진행 보조 검토 시점" style={{display:"flex",gap:6,flexWrap:"wrap"}}>{state.reviews.map(r=><button key={r.id} onClick={()=>setChosen(r.id)} className={`${s.btn} ${selected.id===r.id?s.btnPrimary:""}`} aria-pressed={selected.id===r.id}>{time(r.toMs)}{r.partial?" 종료":""}</button>)}</nav>
   {selected.sourceChanged&&<p role="alert" className={s.error}>발언·화자가 수정된 이전 검토입니다. 현재 원문으로 다시 체크한 후보를 사용해 주세요.</p>}
   <p><span className={s.muted}>AI 구간 요약 · 합의 확정 아님</span><br/>{selected.assessed.review.summary}</p>
   <p className={s.muted}>{selected.assessed.notification?"근거를 바탕으로 확인 질문을 표시했습니다.":"이 시점에는 자동 알림 없음"} · 새 발언 {selected.sourceCount}개</p>
   {selected.assessed.review.findings.map((f,i)=><article key={i} style={{borderTop:"1px solid #e2e8f0",paddingTop:14,marginTop:14}}><strong>{label[f.kind]} · 후보</strong><p>{f.summary}</p><p>{f.question}</p><button disabled={saving||selected.sourceChanged} className={s.btn} onClick={()=>void importFinding(selected.id,i)}>함께 확인하기</button>{f.evidence.map((ev,j)=><a key={j} href={`#u_${ev.uid}`} onClick={()=>document.getElementById(`u_${ev.uid}`)?.scrollIntoView({block:"center",behavior:"smooth"})} style={{display:"block",margin:"8px 0",padding:10,background:"#f8fafc",color:"#1d4ed8",borderRadius:6}}>{ev.uid} “{ev.quote}”{ev.context==="example"?" (사례·인용)":""}</a>)}</article>)}
   {!!selected.assessed.held.length&&<details style={{marginTop:16}}><summary>알림을 보류한 이유</summary><ul>{selected.assessed.held.map((x,i)=><li key={i}>{x}</li>)}</ul></details>}
  </>}
  <p className={s.muted} style={{marginTop:20}}>관찰 주기는 경고 강도가 아닙니다. 90초 미만의 짧은 이탈은 알림을 보류하고, 같은 종류의 알림은 두 관찰 주기 동안 반복하지 않습니다. 초기 운영 기준이며 정확도가 검증된 임계치는 아닙니다.</p>
 </section>;
}
