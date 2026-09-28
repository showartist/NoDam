"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABELS, SOURCE_LABELS, previewText, type IntakeInput } from "@/lib/meetingIntake/model";
import s from "../v2.module.css";
export default function IntakeForm(props:{projects:{id:string;title:string}[];initialMode:"live"|"text";initialProjectId:string;storagePath:string}) {
  const router=useRouter();
  const [title,setTitle]=useState(""); const [purpose,setPurpose]=useState("");
  const [kind,setKind]=useState<IntakeInput["kind"]>("discussion");
  const [mode,setMode]=useState<IntakeInput["mode"]>(props.initialMode);
  const [sourceType,setSourceType]=useState<IntakeInput["sourceType"]>("actual");
  const [projectId,setProjectId]=useState(props.projects.some(p=>p.id===props.initialProjectId)?props.initialProjectId:"");
  const [text,setText]=useState(""); const [sourceName,setSourceName]=useState<string|null>(null);
  const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const request=useRef<{signature:string;id:string}|null>(null);
  const preview=useMemo(()=>previewText(text),[text]);
  async function readFile(file?:File) {
    if(!file)return;
    setError("");setConfirmed(false);
    if(!/\.(txt|md)$/i.test(file.name)||file.size>400_000){setError("UTF-8 TXT·MD 파일(최대 400KB)을 선택해 주세요. SRT·VTT는 다음 단계에서 지원합니다.");return;}
    try {const value=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());if(value.length>100_000||value.includes("\0"))throw new Error("텍스트는 100,000자 이내여야 하며 바이너리 파일은 읽을 수 없습니다.");setText(value);setSourceName(file.name);}
    catch(e){setError(e instanceof Error?e.message:"파일을 읽지 못했습니다.");}
  }
  async function save(e:React.FormEvent) {
    e.preventDefault(); if(busy)return;setBusy(true);setError("");
    const input={title,purpose,kind,mode,sourceType:mode!=="text"?"actual":sourceType,projectId:projectId||null,text:mode==="text"?text:"",sourceName:mode==="text"?sourceName:null};
    const signature=JSON.stringify(input);if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    try {const response=await fetch("/api/meetings/intake",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...input,requestId:request.current.id})});const result=await response.json();if(!response.ok)throw new Error(result.error??"저장에 실패했습니다.");router.push(`/v2/m/${result.meetingId}`);}
    catch(e){setError(e instanceof Error?e.message:"저장하지 못했습니다. 입력은 유지됩니다.");setBusy(false);}
  }
  return <main className={s.page}><div className={`${s.wrap} ${s.form}`}>
    <nav className={s.nav}><Link href="/v2">동상이몽</Link><span>회의 준비</span></nav>
    <h1 className={s.title}>무엇을 함께 이야기할까요?</h1><p className={s.muted}>먼저 기록을 저장합니다. AI 분석과 마이크 녹음은 다음 화면에서 선택합니다.</p>
    <form onSubmit={save}>
      <label htmlFor="title">회의명 *</label><input id="title" required maxLength={150} value={title} onChange={e=>setTitle(e.target.value)} placeholder="예: 광고의 따뜻한 분위기 정하기"/>
      <label htmlFor="purpose">회의 목적 *</label><input id="purpose" required maxLength={1000} value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="이번 회의에서 논의하거나 결정할 문제"/>
      <label htmlFor="kind">회의 종류</label><select id="kind" value={kind} onChange={e=>setKind(e.target.value as IntakeInput["kind"])}>{Object.entries(KIND_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <label htmlFor="project">저장할 프로젝트</label><select id="project" value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">새 프로젝트 — 회의명으로 생성</option>{props.projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select>
      <p className={s.small}>기존 프로젝트를 선택해도 이전 회의의 원문·결정은 이번 분석에 자동으로 가져오지 않습니다.</p>
      <label htmlFor="mode">어떻게 시작할까요?</label><select id="mode" value={mode} onChange={e=>{setMode(e.target.value as IntakeInput["mode"]);setConfirmed(false);}}><option value="live">마이크로 새 회의</option><option value="text">텍스트 직접 입력 / TXT·MD 가져오기</option><option value="audio">녹음 파일 업로드 준비</option></select>
      {mode==="text"&&<><label htmlFor="sourceType">자료 유형 *</label><select id="sourceType" value={sourceType} onChange={e=>{setSourceType(e.target.value as IntakeInput["sourceType"]);setConfirmed(false);}}>{Object.entries(SOURCE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></>}
      {mode==="text"&&<>
        <label htmlFor="sourceFile">텍스트 파일 (선택)</label><input id="sourceFile" type="file" accept=".txt,.md,text/plain,text/markdown" onChange={e=>void readFile(e.target.files?.[0])}/>
        <label htmlFor="text">원문 텍스트 *</label><textarea id="text" required maxLength={100_000} value={text} onChange={e=>{setText(e.target.value);setConfirmed(false);}} placeholder={'민지: 따뜻한 광고를 원해요.\n준호: 저는 빈 부엌을 생각했어요.'}/>
        <p className={s.small}>한 줄을 한 발언으로 저장합니다. ‘이름: 발언’ 또는 ‘00:12 이름: 발언’을 지원하며 화자 없는 줄은 미확인으로 남깁니다. 가져온 텍스트를 수정하면 수정한 입력이 이번 원본으로 저장됩니다.</p>
        <section className={s.card} aria-label="발언 미리보기"><h2>저장 전 확인 · {preview.turns.length}개 발언</h2>{preview.warnings.map(w=><p key={w} className={s.small}>{w}</p>)}{preview.turns.slice(0,20).map(t=><div key={t.uid} className={s.record}><strong>{t.uid} · {t.speaker??"미확인 화자"}</strong><p>{t.text}</p></div>)}{preview.turns.length>20&&<p>처음 20개만 표시합니다. 전체 내용은 위 원문과 저장 후 화면에서 확인할 수 있습니다.</p>}</section>
        <label style={{display:"flex",gap:10,alignItems:"center"}}><input style={{width:"auto"}} type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>자료 유형과 발언 구분을 확인했습니다.</label>
      </>}
      {mode==="audio"&&<p className={s.notice}>회의를 먼저 저장한 뒤 다음 화면에서 녹음 파일을 업로드합니다. 오디오 전사에는 외부 ASR API가 사용됩니다.</p>}
      <p className={s.small}>기록 저장 위치: {props.storagePath}<br/>현재는 앱 서버의 SQLite에 저장합니다. 프로젝트별 폴더 지정·자동 파일 내보내기는 아직 지원하지 않습니다.</p>
      {error&&<p role="alert" className={s.error}>{error}</p>}
      <button className={s.button} disabled={busy||!title.trim()||!purpose.trim()||(mode==="text"&&(!text.trim()||!confirmed||preview.turns.length>2000))}>{busy?"저장 중…":"저장하고 회의 열기"}</button>
    </form>
  </div></main>;
}
