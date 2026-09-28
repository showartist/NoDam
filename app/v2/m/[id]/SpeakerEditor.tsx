"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {MeetingUtterance} from "@/lib/alignment/store";
import {ListenButton} from "./AudioReview";
import s from "../../v2.module.css";
export default function SpeakerEditor({meetingId,turns,hasAudio}:{meetingId:string;turns:MeetingUtterance[];hasAudio:boolean}){
 const router=useRouter(),[selected,setSelected]=useState<string[]>([]),[name,setName]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const groups=[...new Set(turns.map(u=>u.speakerKey).filter((k):k is string=>k!==null))];
 function group(key:string){setSelected(ids=>[...new Set([...ids,...turns.filter(u=>u.speakerKey===key).map(u=>u.uid)])]);setMessage("");}
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage("");try{
  const r=await fetch(`/api/meetings/${meetingId}/speaker-edit`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({speakerName:name,turns:turns.filter(u=>selected.includes(u.uid)).map(u=>({uid:u.uid,expectedText:u.text,expectedSpeakerName:u.speakerName,expectedSpeakerKey:u.speakerKey}))})}),j=await r.json();if(!r.ok)throw new Error(j.error);
  setSelected([]);setMessage(`${j.updated}개 발언의 화자를 저장했습니다. 기존 분석은 다시 체크해 주세요.`);window.dispatchEvent(new CustomEvent("nodam-source-edited",{detail:{meetingId}}));router.refresh();
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <details className={s.card}><summary>화자 한 번에 수정·합치기</summary><p className={s.small}>같은 사람인지 원음을 확인한 발언만 선택하세요. 여러 자동 화자 그룹을 선택하고 같은 이름으로 저장하면 한 사람의 발언으로 묶입니다. ‘미확인’은 개별 선택합니다.</p><div className={s.actions}>{groups.map(key=>{const rows=turns.filter(u=>u.speakerKey===key);return <button type="button" disabled={busy} className={s.secondary} key={key} onClick={()=>group(key)}>{rows[0].speakerName??key} · {rows.length}개 선택</button>;})}<button type="button" disabled={busy} className={s.secondary} onClick={()=>setSelected([])}>선택 해제</button></div><form onSubmit={save}><div className={s.raw} style={{marginTop:16}}>{turns.map(u=><div className={s.record} key={u.uid}><label><input type="checkbox" disabled={busy} checked={selected.includes(u.uid)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,u.uid]:ids.filter(id=>id!==u.uid))}/> {u.uid} · {u.speakerName??u.speakerId??"미확인"} · {u.text}</label>{hasAudio&&u.startMs!==null&&<ListenButton meetingId={meetingId} startMs={u.startMs}/>}</div>)}</div><div className={s.form}><label>확인한 화자명<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} required disabled={busy}/></label></div><p>선택한 <strong>{selected.length}개 발언</strong>을 <strong>{name.trim()||"입력한 이름"}</strong>으로 저장합니다. 원문과 수정 이력은 보존합니다.</p><button className={s.button} disabled={busy||!selected.length||!name.trim()}>{busy?"저장 중…":"선택한 발언의 화자 저장"}</button>{message&&<p role="status">{message}</p>}</form></details>;
}
