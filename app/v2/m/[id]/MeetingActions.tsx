"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import s from "../../v2.module.css";
export default function MeetingActions({meetingId,hasText,running}:{meetingId:string;hasText:boolean;running:boolean}) {
  const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>router.refresh(),5000);return ()=>clearInterval(timer);},[running,router]);
  async function analyze(){setBusy(true);setError("");try{
    const r=await fetch(`/api/meetings/${meetingId}/analyze-v2`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const j=await r.json();if(!r.ok)throw new Error(j.error??"분석에 실패했습니다.");
  }catch(e){setError(e instanceof Error?e.message:"분석을 완료하지 못했습니다.");}finally{setBusy(false);router.refresh();}}
  return <div><p className={s.small}>분석을 실행하면 저장된 텍스트와 회의 목적을 OpenRouter의 AI 모델에 전송합니다. 처리 시간과 비용이 발생합니다.</p>
    <div className={s.actions}><button className={s.button} disabled={busy||running} onClick={()=>void analyze()}>{busy?"분석 중… 기록은 저장되어 있습니다":running?"분석 처리 중":"동상이몽 체크하기"}</button><button className={s.secondary} onClick={()=>router.refresh()}>저장된 결과 새로고침</button></div>
    {error&&<p role="alert" className={s.error}>{error}<br/>원문은 저장되어 있습니다. 오류를 확인한 뒤 다시 분석할 수 있습니다.</p>}
  </div>;
}
