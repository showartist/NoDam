"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import s from "../../v2.module.css";
export default function ImportIssue({meetingId,runId,issueId,inline=false}:{meetingId:string;runId:string;issueId:string;inline?:boolean}){
 const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState("");
 async function open(){setBusy(true);setError("");try{
  const url=`/api/meetings/${meetingId}/decisions`;
  const before=await fetch(url,{cache:"no-store"}),state=await before.json();if(!before.ok)throw new Error(state.error);
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({revision:state.revision,command:{action:"import_analysis",runId,issueId}})}),j=await r.json();if(!r.ok)throw new Error(j.error);
  const q=j.questions.find((q:{id:string;analysisSource?:{runId:string;issueId:string}})=>q.analysisSource?.runId===runId&&q.analysisSource.issueId===issueId);
  if(inline){window.dispatchEvent(new CustomEvent("nodam-open-question",{detail:{meetingId,questionId:q.id}}));setBusy(false);return;}
  router.push(`/v2/m/${meetingId}/decisions?question=${encodeURIComponent(q.id)}`);
 }catch(e){setError((e as Error).message);setBusy(false);}}
 return <div><button className={s.button} disabled={busy} onClick={()=>void open()}>{busy?"근거를 가져오는 중…":"이 뜻을 함께 확인하기"}</button>{error&&<p role="alert" className={s.error}>{error}</p>}</div>;
}
