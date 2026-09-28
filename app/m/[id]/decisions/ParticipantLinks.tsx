"use client";
import {useState} from "react";
export function ParticipantLinks({meetingId,participants}:{meetingId:string;participants:{id:string;name:string}[]}){
 const [link,setLink]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function issue(participantId:string,revoke=false){setBusy(true);setLink("");try{const r=await fetch(`/api/meetings/${meetingId}/participant-access`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({participantId,revoke})});const j=await r.json();if(!r.ok)throw new Error(j.error);if(!revoke)setLink(`${location.origin}/join#${j.token}`);setMessage(revoke?"기존 링크를 회수했습니다.":"7일 동안 유효합니다. 새 링크 발급 시 이전 링크는 회수됩니다.");}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <details><summary>참가자에게 개인 응답 링크 전달</summary><p>각 참가자에게 본인 링크만 전달하세요. 참가자는 자신의 해석·동의만 입력할 수 있습니다.</p>{participants.map(p=><p key={p.id}>{p.name} <button disabled={busy} onClick={()=>void issue(p.id)}>개인 링크 발급</button> <button disabled={busy} onClick={()=>void issue(p.id,true)}>링크 회수</button></p>)}{link&&<label>전달할 개인 링크<input readOnly value={link} onFocus={e=>e.currentTarget.select()}/></label>}{message&&<p role="status">{message}</p>}</details>;
}
