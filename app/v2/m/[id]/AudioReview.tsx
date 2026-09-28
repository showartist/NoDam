"use client";
import {useEffect,useRef,useState} from "react";
import type {AudioReviewFlag} from "@/lib/transcription/review";
import s from "../../v2.module.css";
const clock=(ms:number)=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,"0")}`;
export function ListenButton({meetingId,startMs}:{meetingId:string;startMs:number}){
 return <button type="button" className={s.secondary} onClick={()=>window.dispatchEvent(new CustomEvent("nodam-listen",{detail:{meetingId,startMs}}))}>{clock(startMs)} 원음 듣기</button>;
}
export default function AudioReview({meetingId,flags}:{meetingId:string;flags:AudioReviewFlag[]}){
 const ref=useRef<HTMLAudioElement>(null),[message,setMessage]=useState("");
 useEffect(()=>{
  const listen=(event:Event)=>{const d=(event as CustomEvent).detail;if(d.meetingId!==meetingId||!Number.isFinite(d.startMs))return;const audio=ref.current;if(!audio)return;audio.currentTime=Math.max(0,d.startMs/1000);void audio.play().then(()=>setMessage(`${clock(d.startMs)}부터 재생 중`)).catch(()=>setMessage("재생 버튼을 눌러 원음을 들어 주세요."));};
  window.addEventListener("nodam-listen",listen);return()=>window.removeEventListener("nodam-listen",listen);
 },[meetingId]);
 return <section className={`${s.card} ${s.section}`}><h2>원음과 전사 대조</h2><audio ref={ref} controls preload="metadata" src={`/api/meetings/${meetingId}/audio`} style={{width:"100%"}} onError={()=>setMessage("원음을 불러오지 못했습니다. 파일이 보존되어 있는지 확인해 주세요.")}/>{message&&<p role="status">{message}</p>}<p className={s.small}>발언 옆 ‘원음 듣기’로 해당 시간부터 재생합니다. 자동 화자 번호는 실제 사람과 다를 수 있습니다.</p><details open={flags.length>0}><summary>우선 들어볼 구간 {flags.length}개</summary><p className={s.small}>전사가 비거나 조각 경계의 시간이 겹친 구간입니다. 누락·중복으로 확정한 것이 아니므로, 원음을 듣고 판단해 주세요. 표시가 없어도 전사 정확성을 보장하지 않습니다.</p>{flags.map((f,i)=><div className={s.record} key={i}><ListenButton meetingId={meetingId} startMs={f.startMs}/><span> ~ {clock(f.endMs)} · {f.kind==="empty_chunk"?"전사된 단어 없음":"조각 경계 시간 겹침"}</span></div>)}</details></section>;
}
