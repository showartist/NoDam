import Link from "next/link";
import { db } from "@/lib/db";
import { SOURCE_LABELS } from "@/lib/meetingIntake/model";
import s from "./v2.module.css";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default function V2Home() {
  const meetings = db().prepare(`SELECT m.id,m.title,m.created_at,p.id project_id,p.title project_title,i.source_type,
    (SELECT COUNT(*) FROM utterances u WHERE u.meeting_id=m.id) utterances,
    (SELECT status FROM alignment_v2_runs r WHERE r.meeting_id=m.id ORDER BY created_at DESC,rowid DESC LIMIT 1) analysis_status
    FROM meetings m JOIN projects p ON p.id=m.project_id LEFT JOIN meeting_intake i ON i.meeting_id=m.id
    ORDER BY m.created_at DESC LIMIT 30`).all() as {id:string;title:string|null;created_at:string;project_id:string;project_title:string;source_type:keyof typeof SOURCE_LABELS|null;utterances:number;analysis_status:string|null}[];
  const projects = [...new Map(meetings.map(m=>[m.project_id,m.project_title])).entries()];
  return <main className={s.page}><div className={s.wrap}>
    <nav className={s.nav}><strong>동상이몽</strong><Link href="/">기존 제작 화면</Link></nav>
    <span className={s.eyebrow}>MVP v2 · 첫 단계</span><h1 className={s.title}>같은 말, 서로의 뜻부터.</h1>
    <p className={s.muted}>회의를 기록하고, 다른 뜻으로 이해한 부분을 함께 확인하세요.<br/>AI의 제안은 원문으로 확인하고 결정은 사람이 합니다.</p>
    <div className={s.grid}>
      <Link className={s.card} href="/v2/new?mode=live"><h2>새 회의 시작</h2><p className={s.muted}>회의명과 목적을 정하고 마이크 회의를 준비합니다.</p></Link>
      <a className={s.card} href="#projects"><h2>기존 프로젝트 열기</h2><p className={s.muted}>저장한 기록을 찾고 같은 프로젝트에 회의를 추가합니다.</p></a>
      <Link className={s.card} href="/v2/new?mode=text"><h2>자료 가져오기</h2><p className={s.muted}>텍스트·TXT·MD를 확인하거나 녹음 파일 업로드로 이어갑니다.</p></Link>
    </div>
    <section id="projects" className={s.section}><h2>최근 회의와 프로젝트</h2>
      <p className={s.small}>최근 회의 30개를 프로젝트별로 표시합니다. 아래 상태는 기록·분석 상태이며 회의의 종료 여부가 아닙니다.</p>
      {!meetings.length&&<p className={s.muted}>아직 저장된 회의가 없습니다. 위에서 첫 회의를 시작하세요.</p>}
      {projects.map(([id,title])=><article key={id} className={`${s.card} ${s.project}`}><h3>{title}</h3>
        <Link href={`/v2/new?projectId=${encodeURIComponent(id)}`}>이 프로젝트에 새 회의</Link><ul>{meetings.filter(m=>m.project_id===id).map(m=><li key={m.id}>
          <Link href={`/v2/m/${m.id}`}>{m.title||"제목 없는 회의"}</Link> · <span className={s.small}>{m.created_at.slice(0,10)} · {m.utterances}개 발언 · {m.analysis_status==="completed"?"분석 기록 있음":m.analysis_status==="running"?"분석 중":m.analysis_status==="failed"?"분석 재시도 필요":"분석 전"}{m.source_type?` · ${SOURCE_LABELS[m.source_type]}`:" · 자료 유형 미지정"}</span>
        </li>)}</ul></article>)}
    </section>
  </div></main>;
}
