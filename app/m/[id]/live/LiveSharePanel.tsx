"use client";
import {useEffect,useState,useRef} from "react";
type State={configured:boolean;enabled:boolean;url:string|null;lastSync:string|null;error:string|null};
export function LiveSharePanel({meetingId}:{meetingId:string}){
 const [state,setState]=useState<State|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);const running=useRef(false);
 async function change(action:"start"|"sync"|"stop"){
  if(running.current)return;running.current=true;if(action!=="sync")setBusy(true);
  try{const r=await fetch(`/api/meetings/${meetingId}/live/share`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});const j=await r.json();if(!r.ok)throw new Error(j.error);setState(j);setError(null);}catch(e){setError((e as Error).message);}finally{running.current=false;setBusy(false);}
 }
 useEffect(()=>{fetch(`/api/meetings/${meetingId}/live/share`).then(r=>r.json()).then(setState).catch(e=>setError(e.message));},[meetingId]);
 useEffect(()=>{if(!state?.enabled)return;const t=setInterval(()=>void change("sync"),5000);return()=>clearInterval(t);},[state?.enabled,meetingId]);
 return <section aria-label="팀 실시간 공유" style={{background:"#fff",border:"1px solid #dbe3ee",borderRadius:12,padding:18,marginBottom:18}}><strong>팀 실시간 공유</strong><p style={{fontSize:13,color:"#64748b"}}>공유를 켜면 이 회의의 원문과 검토 결과를 링크를 받은 누구나 볼 수 있습니다. 이 화면이 열려 있는 동안 5초마다 갱신합니다.</p>{state?.configured?<>{state.enabled&&state.url?<><a href={state.url} target="_blank" rel="noreferrer">팀원용 회의 화면 열기</a> <button disabled={busy} onClick={()=>navigator.clipboard.writeText(state.url!).catch(()=>setError("링크를 직접 복사해 주세요."))}>링크 복사</button> <button disabled={busy} onClick={()=>void change("stop")}>공유 종료</button><p style={{fontSize:12}}>마지막 공유 {state.lastSync?new Date(state.lastSync).toLocaleTimeString("ko-KR"):"전송 중"}</p></>:<button disabled={busy} onClick={()=>void change("start")}>이 회의를 팀에 실시간 공유</button>}</>:<p>공유 서버 연결을 준비 중입니다.</p>}{(error||state?.error)&&<p role="alert" style={{color:"#b91c1c"}}>{error||state?.error}</p>}</section>;
}
