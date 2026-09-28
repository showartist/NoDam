"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import s from "../../v2.module.css";
export default function AudioInput({meetingId}:{meetingId:string}){
 const router=useRouter(),lock=useRef(false);const [file,setFile]=useState<File|null>(null),[job,setJob]=useState<string|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState(""),[error,setError]=useState("");
 const key=`scenenote-transcription:${meetingId}`,url=`/api/meetings/${meetingId}/audio-transcribe`;
 useEffect(()=>{try{setJob(localStorage.getItem(key));}catch{setError("이 브라우저에서 이어서 처리할 작업을 읽을 수 없습니다.");}},[key]);
 async function transcribe(resume=false){if(lock.current)return;lock.current=true;setBusy(true);setError("");setStatus(resume?"저장된 전사 이어서 처리 중":"녹음 업로드 중");
 try{
  let r:Response;
  if(resume){r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId:job,retryFailed:true})});}
  else{if(!file)throw new Error("녹음 파일을 선택해 주세요.");const form=new FormData();form.append("file",file);r=await fetch(url,{method:"POST",body:form});}
  for(;;){const j=await r.json();if(!r.ok||!j.success)throw new Error(j.error??"전사하지 못했습니다.");
   if(r.status!==202){localStorage.removeItem(key);setJob(null);setStatus(`전사 저장 완료 · ${j.utteranceCount}개 발언 · ${j.model}`);router.refresh();break;}
   setJob(j.jobId);localStorage.setItem(key,j.jobId);setStatus(`전사 중 · ${j.completedChunks}/${j.totalChunks} 조각 저장됨`);
   r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jobId:j.jobId})});
  }
 }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}}
 return <section className={`${s.card} ${s.section}`}><h2>녹음 파일에서 발언 가져오기</h2><p className={s.muted}>파일을 OpenRouter로 보내 전사합니다. 전사가 끝나면 아래에서 원문을 확인하고 동상이몽 체크를 실행하세요.</p>
 <label>음성·영상 파일 <input type="file" accept="audio/*,video/mp4,video/webm" disabled={busy||!!job} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
 <div className={s.actions}><button className={s.button} disabled={busy||!!job||!file} onClick={()=>void transcribe()}>업로드하고 전사하기</button>{job&&<button className={s.secondary} disabled={busy} onClick={()=>void transcribe(true)}>저장된 전사 이어서 처리</button>}</div>
 {status&&<p role="status">{status}</p>}{error&&<p role="alert" className={s.error}>{error}<br/>저장된 작업이 있으면 이어서 처리할 수 있습니다.</p>}</section>;
}
