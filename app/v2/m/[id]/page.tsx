import Link from "next/link";
import {meetingSegments} from "@/lib/live/segments";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getIntakeMetadata } from "@/lib/meetingIntake/store";
import { KIND_LABELS, SOURCE_LABELS } from "@/lib/meetingIntake/model";
import { getMeetingUtterances, listIssues, listRuns } from "@/lib/alignment/store";
import { ISSUE_TYPE_LABEL } from "@/lib/alignment/present";
import ImportIssue from "./ImportIssue";
import LiveInput from "./LiveInput";
import AudioInput from "./AudioInput";
import { intakeContext } from "@/lib/meetingIntake/store";
import {recoverAnalysisJobs,analysisScope,analysisSourceChanged} from "@/lib/alignment/jobs";
import SourceEditor from "./SourceEditor";
import AudioReview,{ListenButton} from "./AudioReview";
import SpeakerEditor from "./SpeakerEditor";
import {getAudioSource} from "@/lib/transcription/source";
import {settledIssues} from "@/lib/alignment/settled";
import MeetingActions from "./MeetingActions";
import s from "../../v2.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function MeetingV2({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  const m=db().prepare("SELECT m.title,m.project_id,m.raw_transcript,p.title project_title FROM meetings m JOIN projects p ON p.id=m.project_id WHERE m.id=?").get(id) as {title:string|null;project_id:string;raw_transcript:string;project_title:string}|undefined;
  if(!m)notFound();
  recoverAnalysisJobs(id);
  const info=getIntakeMetadata(id),utts=getMeetingUtterances(id),runs=listRuns(id),run=runs.find(r=>r.mode==="batch")??null;
  const scope=run?analysisScope(run.id):null;
  const stt=db().prepare("SELECT diarization_status,model FROM transcription_runs WHERE meeting_id=? ORDER BY created_at DESC LIMIT 1").get(id) as {diarization_status:string;model:string}|undefined;
  const audio=getAudioSource(id),settled=settledIssues(run?.stats_json??null);
  const issues=run?listIssues(id,run.id):[];
  const practice=info&&info.source_type!=="actual";
  return <main className={s.page}><div className={s.wrap}>
    <nav className={s.nav}><Link href="/v2">← 동상이몽 · 프로젝트</Link><Link href={`/v2/new?projectId=${encodeURIComponent(m.project_id)}`}>같은 프로젝트에 새 회의</Link></nav>
    <span className={s.badge}>{info?SOURCE_LABELS[info.source_type]:"자료 유형 미지정 · 기존 회의"}</span>
    <h1 className={s.title}>{m.title||m.project_title}</h1><p className={s.muted}>{info?.purpose||"기존 회의의 원문과 분석을 확인합니다."}</p>
    <p className={s.small}>{m.project_title} · {info?KIND_LABELS[info.kind]:"기존 자료"} · 기록 저장됨 · {utts.length}개 발언</p>
    {practice&&<p className={s.notice}>가상·예정 자료입니다. 실제 참석자의 발언·동의로 확정하지 않습니다. 이 자료에서는 실제 결정 승인을 사용할 수 없습니다.</p>}
    {info?.input_mode==="live"&&!practice&&<section className={`${s.card} ${s.section}`}><LiveInput meetingId={id} projectId={m.project_id} goal={intakeContext(info)} hasText={utts.length>0}/></section>}
    {info?.input_mode==="audio"&&!practice&&!utts.length&&<AudioInput meetingId={id}/>}
    {info?.input_mode!=="live"&&<div className={s.actions}><Link className={s.secondary} href={`/v2/m/${id}/decisions`}>함께 뜻 확인·결정 기록</Link></div>}
    {(stt||info?.input_mode==="live")&&<p className={s.notice}>화자 구분: {stt?.diarization_status==="ok"?"자동 구분 · 실제 이름은 본인 확인 필요":"미확인 · 같은 화자 번호가 항상 같은 사람이라는 보장은 없습니다."} 이름과 발언을 대조한 뒤 해석 차이를 확인해 주세요.</p>}
    {audio&&<AudioReview meetingId={id} flags={audio.flags}/>}
    {!!utts.length&&<section className={s.section}><SpeakerEditor meetingId={id} turns={utts} hasAudio={!!audio}/></section>}
    <section className={`${s.card} ${s.section}`}><h2>함께 확인할 내용</h2>
      {run&&analysisSourceChanged(run.id,id)&&<p role="alert" className={s.notice}>발언·화자가 수정되어 이전 분석이 오래되었습니다. 다시 체크해 주세요.</p>}
      {scope&&<p className={s.small}>분석 범위: {scope.through_uid}까지 저장된 {scope.source_count}개 발언. 그 뒤 들어온 발언은 다음 체크에 포함됩니다.</p>}
      <p className={s.muted}>{!run?"아직 AI 분석을 실행하지 않았습니다.":run.status==="completed"?`확인 후보 ${issues.length}건 · AI 분석 기록 있음`:run.status==="failed"?"최근 분석이 실패했습니다. 원문을 보존한 채 재시도할 수 있습니다.":"AI 분석을 처리하고 있습니다."}</p>
      {run&&<p className={s.small}>사용 모델: {run.model} · {run.created_at}{run.error?` · ${run.error}`:""}</p>}
      <MeetingActions meetingId={id} hasText={utts.length>0} running={run?.status==="running"}/>
      {issues.map(issue=><article className={s.record} key={issue.issue_id}><span className={s.badge}>{ISSUE_TYPE_LABEL[issue.type].label}</span><h3>{issue.decision}</h3><p>{issue.question}</p>{issue.positions.map((p,i)=><p key={i}><strong>{p.speaker.name??"미확인 화자"}</strong> · {p.meaning}<br/><span className={s.small}>근거: {p.evidence.join(", ")} · “{p.quote}”</span></p>)}{run?.status==="completed"&&<ImportIssue inline={info?.input_mode==="live"&&!practice} meetingId={id} runId={run.id} issueId={issue.issue_id}/>}</article>)}
      {settled.length>0&&<details className={s.notice}><summary>AI가 대화에서 정리됐다고 본 안건 {settled.length}건 · 사람의 승인 아님</summary><p>확인 후보에서 제외한 이유입니다. 근거를 읽고 필요하면 다시 확인 안건으로 가져오세요.</p>{settled.map(item=><article className={s.record} key={item.issue_id}><h3>{item.issue?.decision??item.issue_id}</h3>{item.issue&&<p>기존 질문: {item.issue.question}</p>}<p>{item.note}</p>{item.evidence.map(uid=>{const u=utts.find(u=>u.uid===uid);return <p key={uid}><a href={`#u_${uid}`}>{uid}</a> · {u?.text??"현재 원문에서 찾을 수 없는 근거"}{audio&&u?.startMs!=null&&<ListenButton meetingId={id} startMs={u.startMs}/>}</p>;})}{run?.status==="completed"&&item.issue&&<ImportIssue meetingId={id} runId={run.id} issueId={item.issue_id}/>}</article>)}</details>}
      {run&&<p><Link href={`/m/${id}/alignment`}>기존 상세 분석 화면에서 근거 보기</Link></p>}
    </section>
    {info?.input_mode==="live"&&<section className={`${s.card} ${s.section}`}><h2>회의 구간·종료 기록</h2><p className={s.small}>이어 녹음해도 이전 구간의 원문과 결정 기록은 보존됩니다. 파일은 각 구간 종료 당시의 누적 기록입니다.</p>{meetingSegments(id).map((segment,i)=><p key={segment.id}>{i+1}구간 · {segment.started_at} · {segment.status==="stopped"?"종료": "처리 중"} {segment.saved_at&&<a href={`/api/meetings/${id}/segments?session=${segment.id}`}>종료 당시 기록 내려받기</a>}</p>)}</section>}
    <section className={`${s.card} ${s.section}`}><h2>저장된 발언</h2><p className={s.small}>이름 없는 줄은 미확인으로 남깁니다. 지문과 실제 발언의 구분을 확인해 주세요. 아래에서 발언과 화자명을 수정하면 이전 분석의 변경 여부를 표시합니다.</p>
      {!utts.length&&<p className={s.muted}>아직 발언이 없습니다. 마이크 회의를 시작하거나 녹음 파일을 업로드해 주세요.</p>}
      {utts.map(u=><article key={u.uid} id={`u_${u.uid}`} className={s.record}><strong>{u.uid} · {u.speakerName??u.speakerId??"미확인 화자"}</strong><span className={s.small}> · {u.startMs===null?"시간 없음":`${Math.floor(u.startMs/60000)}:${String(Math.floor(u.startMs/1000)%60).padStart(2,"0")}`}</span><p>{u.text}</p>{audio&&u.startMs!==null&&<ListenButton meetingId={id} startMs={u.startMs}/>}</article>)}
      {!!utts.length&&<SourceEditor key={JSON.stringify(utts)} meetingId={id} turns={utts}/>}
      <details><summary>입력 당시 원문 보기</summary><pre className={s.raw}>{m.raw_transcript||"텍스트 원문 없음 · 음성 입력은 전사 기록으로 저장됩니다."}</pre></details>
    </section>
  </div></main>;
}
