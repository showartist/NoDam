"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {MeetingUtterance} from "@/lib/alignment/store";
import s from "../../v2.module.css";
export default function SourceEditor({meetingId,turns}:{meetingId:string;turns:MeetingUtterance[]}){
 const router=useRouter();const [uid,setUid]=useState(turns[0]?.uid??""),[text,setText]=useState(turns[0]?.text??""),[name,setName]=useState(turns[0]?.speakerName??""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const selected=turns.find(u=>u.uid===uid);
 function choose(id:string){const u=turns.find(u=>u.uid===id);setUid(id);setText(u?.text??"");setName(u?.speakerName??"");setMessage("");}
 async function save(e:React.FormEvent){e.preventDefault();if(!selected)return;setBusy(true);setMessage("");try{const r=await fetch(`/api/meetings/${meetingId}/source-edit`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({uid,text,speakerName:name||null,expectedText:selected.text,expectedSpeakerName:selected.speakerName})}),j=await r.json();if(!r.ok)throw new Error(j.error);setMessage("수정 이력을 저장했습니다. 기존 분석은 원문 변경 여부를 다시 확인합니다.");window.dispatchEvent(new CustomEvent("nodam-source-edited",{detail:{meetingId}}));router.refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <details className={s.card}><summary>발언·화자 확인 및 수정</summary><p className={s.small}>녹음 종료 후 수정할 수 있습니다. 실제 목소리와 원문을 대조해 이름을 입력하세요. 같은 이름으로 수정한 발언은 같은 화자로 분석합니다. 원래 전사와 수정 이력은 보존됩니다.</p><form className={s.form} onSubmit={save}><label>수정할 발언<select value={uid} onChange={e=>choose(e.target.value)} disabled={busy}>{turns.map(u=><option key={u.uid} value={u.uid}>{u.uid} · {u.text.slice(0,45)}</option>)}</select></label><label>확인한 화자명 · 모르면 비우기<input value={name} onChange={e=>setName(e.target.value)} maxLength={80} disabled={busy}/></label><label>발언 내용<textarea value={text} onChange={e=>setText(e.target.value)} required maxLength={10000} disabled={busy}/></label><button className={s.button} disabled={busy||!selected}>수정 저장</button>{message&&<p role="status">{message}</p>}</form></details>;
}
