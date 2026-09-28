"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {LiveBoard} from "@/app/m/[id]/live/LiveBoard";
import {DecisionBoard} from "@/app/m/[id]/decisions/DecisionBoard";
export default function LiveInput({meetingId,projectId,goal,hasText}:{meetingId:string;projectId:string;goal:string;hasText:boolean}){
 const router=useRouter(),[question,setQuestion]=useState(""),[recording,setRecording]=useState(false);
 useEffect(()=>{const open=(e:Event)=>{const d=(e as CustomEvent).detail;if(d.meetingId===meetingId)setQuestion(d.questionId);};window.addEventListener("nodam-open-question",open);return ()=>window.removeEventListener("nodam-open-question",open);},[meetingId]);
 useEffect(()=>{if(question)document.getElementById("live-clarification")?.scrollIntoView({behavior:"smooth"});},[question]);
 useEffect(()=>{
  if(!recording)return;
  const leave=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};
  const click=(e:MouseEvent)=>{const a=(e.target as Element).closest?.("a");if(!a||a.target==="_blank")return;const to=new URL(a.href,location.href);if(to.pathname===location.pathname&&to.search===location.search)return;e.preventDefault();e.stopPropagation();window.alert("녹음을 유지하려면 이 화면에서 확인해 주세요. 이동하려면 먼저 녹음을 종료해 주세요.");};
  window.addEventListener("beforeunload",leave);document.addEventListener("click",click,true);
  return ()=>{window.removeEventListener("beforeunload",leave);document.removeEventListener("click",click,true);};
 },[recording]);
 return <><button type="button" onClick={()=>setQuestion("board")}>함께 뜻 확인·결정 기록</button><LiveBoard embedded meetingId={meetingId} sources={[]} initialGoal={goal} hasUtterances={hasText} newMeetingHref={`/v2/new?projectId=${encodeURIComponent(projectId)}`} onStopped={()=>router.refresh()} onQuestion={setQuestion} onRecordingChange={setRecording}/>
 {question&&<section id="live-clarification"><p>녹음을 유지하면서 아래에서 뜻을 확인할 수 있습니다.</p><DecisionBoard meetingId={meetingId} initialQuestionId={question==="board"?undefined:question} sourceHref=""/></section>}</>;
}
