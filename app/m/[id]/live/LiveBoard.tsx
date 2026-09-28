"use client";
import {LiveSharePanel} from "./LiveSharePanel";

/**
 * 회의 중 화면 (계획서 2-3). 마이크로 녹음하거나 녹음 파일을 재생 모드로 흘려 보내면,
 * 조각마다 전사된 발언이 들어오고, 발언이 쌓이면 창 단위 분석이 안건 카드를 새로 만들거나 갱신한다.
 *
 * 회의 중 발언과 안건은 잠정이다. 정지한 뒤 "회의 전체로 확정 분석"을 누르면 회의 전체를 한 번에 다시 읽는다.
 */
import { LiveCapture, retryLiveChunks, savedLiveChunks, downloadLiveChunks } from "@/lib/recording/liveCapture";
import { FacilitatorPanel, type FacilitatorState } from "./FacilitatorPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlignmentIssueV2 } from "@/lib/alignment/schema";
import { ISSUE_STATE_LABEL, ISSUE_TYPE_LABEL, SEVERITY_LABEL, sortIssues, speakerDisplay } from "@/lib/alignment/present";
import s from "../alignment/v2/v2.module.css";

type Utt = { uid: string; speakerId: string | null; speakerName: string | null; startMs: number | null; endMs: number | null; text: string };
type WindowLog = { from: string; to: string; newIds: string[]; updatedIds: string[]; latencyMs: number };

const CHUNK_MS = 20000;

function clock(ms: number | null): string {
  if (ms == null) return "--:--";
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export function LiveBoard(props: { embedded?: boolean; onQuestion?: (id:string) => void; onRecordingChange?: (active:boolean) => void; onStopped?: () => void; newMeetingHref?: string; initialGoal?: string; meetingId: string; hasUtterances: boolean; sources: string[] }) {
  const [session, setSession] = useState<{ id: string; status: string; mode: string; startedAt?:string; stoppedAt?:string|null } | null>(null);
  const [utts, setUtts] = useState<Utt[]>([]);
  const [issues, setIssues] = useState<Record<string, AlignmentIssueV2>>({});
  const [flash, setFlash] = useState<Record<string, "new" | "update">>({});
  const [windows, setWindows] = useState<WindowLog[]>([]);
  const [chunks, setChunks] = useState<{ idx: number; sttMs: number | null; utterances: number; linkMethod: string; error?: string | null; status?:string }[]>([]);
  const [stage, setStage] = useState<string>("대기 중");
  const [err, setErr] = useState<string | null>(null);
  const [source, setSource] = useState(props.sources[0] ?? "");
  const [speed, setSpeed] = useState(2);
  const [elapsed, setElapsed] = useState(0);
  const [finalizing, setFinalizing] = useState(false);
  const [facilitator,setFacilitator]=useState<FacilitatorState|null>(null);
  const [goal,setGoal]=useState(props.initialGoal??"");
  const [intervalMinutes,setIntervalMinutes]=useState(5);
  const [facilitatorEnabled,setFacilitatorEnabled]=useState(true);
  const [savedChunks,setSavedChunks]=useState(0);
  const [micActive,setMicActive]=useState(false);
  const [finishing,setFinishing]=useState(false);
  useEffect(()=>{props.onRecordingChange?.(micActive);},[micActive,props.onRecordingChange]);
  const rec = useRef<LiveCapture|null>(null);
  const starting = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const loadState = useCallback(async () => {
    const r = await fetch(`/api/meetings/${props.meetingId}/live/state`);
    if (!r.ok) return;
    const j = await r.json();
    setUtts(j.utterances ?? []);
    setFacilitator(j.facilitator??null);
    setChunks((j.chunks??[]).map((c:{idx:number;stt_ms:number|null;error:string|null;status:string})=>({idx:c.idx,sttMs:c.stt_ms,utterances:0,linkMethod:"",error:c.error,status:c.status})));
    setIssues(Object.fromEntries((j.issues ?? []).map((i: AlignmentIssueV2) => [i.issue_id, i])));
    if (j.session) setSession({ id: j.session.id, status: j.session.status, mode: j.session.mode, stoppedAt:j.session.stoppedAt??j.session.stopped_at, startedAt:j.session.startedAt??j.session.started_at });
  }, [props.meetingId]);

  useEffect(() => {
    void loadState();
    const edited=(event:Event)=>{if((event as CustomEvent).detail?.meetingId===props.meetingId)void loadState();};
    window.addEventListener("nodam-source-edited",edited);
    void savedLiveChunks(props.meetingId).then(x=>setSavedChunks(x.length)).catch(e=>setErr(`녹음 복구 저장소 오류: ${e.message}`));
    const es = new EventSource(`/api/meetings/${props.meetingId}/live/events`);
    es.onopen = () => { void loadState(); };
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if(ev.type==="facilitator")setFacilitator(ev.state);
      else if (ev.type === "utterances") setUtts((xs) => [...xs, ...ev.items.filter((it: Utt) => !xs.some((x) => x.uid === it.uid))]);
      else if (ev.type === "issue") {
        const i = ev.issue as AlignmentIssueV2;
        setIssues((xs) => ({ ...xs, [i.issue_id]: i }));
        setFlash((f) => ({ ...f, [i.issue_id]: ev.op }));
        setTimeout(() => setFlash((f) => {
          const { [i.issue_id]: _drop, ...rest } = f;
          return rest;
        }), 6000);
      } else if (ev.type === "window") setWindows((w) => [...w, ev]);
      else if (ev.type === "chunk") setChunks((c) => [...c.filter(x=>x.idx!==ev.idx), ev].sort((a,b)=>a.idx-b.idx));
      else if (ev.type === "status") setStage(ev.label);
      else if (ev.type === "session") {
        setSession((cur) => ({ ...(cur?.id===ev.sessionId?cur:{}), id: ev.sessionId, status: ev.status, mode: ev.mode ?? cur?.mode ?? "" }));
        if (ev.error) setErr(ev.error);
      }
    };
    return () => {window.removeEventListener("nodam-source-edited",edited);es.close();rec.current?.dispose();rec.current=null;};
  }, [props.meetingId, loadState]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [utts.length]);

  useEffect(() => {
    if (session?.status !== "recording") return;
    const t0 = Date.now() - elapsed;
    const t = setInterval(() => setElapsed(Date.now() - t0), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

  async function start(mode: "mic" | "replay",continueMeeting=false) {
    if(starting.current)return;
    setErr(null);
    setElapsed(0);
    if(facilitatorEnabled&&goal.trim().length<10){setErr("회의에서 결정할 목적을 10자 이상 입력해 주세요.");return;}
    let stream: MediaStream | null = null;
    starting.current=true;
    try {
    if (mode === "mic") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        setErr(`마이크를 쓸 수 없습니다: ${(e as Error).message}`);
        return;
      }
    }
    const r = await fetch(`/api/meetings/${props.meetingId}/live/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, continueMeeting, source: mode === "replay" ? source : undefined, speed: mode === "replay" ? speed : undefined, facilitator:facilitatorEnabled?{goal,intervalMinutes}:undefined }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      stream?.getTracks().forEach((t) => t.stop());
      setErr(j.error ?? `시작하지 못했습니다 (HTTP ${r.status})`);
      return;
    }
    setSession({ id: j.sessionId, status: "recording", mode });
    await loadState();
    if (mode === "mic" && stream) startRecorder(j.sessionId, stream,j.baseOffsetMs??0);
    } catch(e) { stream?.getTracks().forEach(t=>t.stop()); setErr(`시작하지 못했습니다: ${(e as Error).message}`); }
    finally { starting.current=false; }
  }

  function startRecorder(sessionId: string, stream: MediaStream, baseOffset=0) {
    setMicActive(true);
    rec.current=new LiveCapture(props.meetingId,sessionId,stream,()=>setSavedChunks(n=>n+1),message=>{setErr(message);setMicActive(false);},baseOffset);
  }

  async function recoverUploads() {
    if(!session)return;
    setErr(null);setStage("저장된 녹음 재전송 중");
    try {
      const response=await fetch(`/api/meetings/${props.meetingId}/live/resume`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:session.id})});
      if(!response.ok)throw new Error((await response.json()).error);
      await retryLiveChunks(props.meetingId,session.id);await loadState();setStage("저장된 조각 전송 완료 · 종료 버튼으로 마무리할 수 있습니다.");}
    catch(e){setErr((e as Error).message);}
  }

  async function reconnectMic() {
    if(!session)return;
    setErr(null);let stream:MediaStream|null=null;
    try {
      const r=await fetch(`/api/meetings/${props.meetingId}/live/resume`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sessionId:session.id})});
      const j=await r.json();if(!r.ok)throw new Error(j.error);
      await retryLiveChunks(props.meetingId,session.id);
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      const snapshot=await (await fetch(`/api/meetings/${props.meetingId}/live/state`)).json();
      const startedAt=snapshot.session?.startedAt??snapshot.session?.started_at;
      if(!startedAt||!Number.isFinite(Date.parse(startedAt)))throw new Error("녹음 시작 시각을 확인하지 못했습니다.");
      const offset=(snapshot.baseOffsetMs??0)+Math.max(0,Date.now()-Date.parse(startedAt));
      startRecorder(session.id,stream,offset);setElapsed(offset);await loadState();
    }catch(e){stream?.getTracks().forEach(t=>t.stop());setErr((e as Error).message);}
  }

  async function stop() {
    if (!session) return;
    setFinishing(true);setStage("녹음 종료 · 남은 전사와 분석 처리 중");
    const r0 = rec.current;
    if (r0) {
      try {await r0.stop();}
      catch(e){setErr(`녹음 조각 전송을 복구한 뒤 종료해 주세요: ${(e as Error).message}`);setFinishing(false);return;}
      finally{rec.current=null;setMicActive(false);}
    }

    try {
    const r = await fetch(`/api/meetings/${props.meetingId}/live/stop`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: session.id }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "정지하지 못했습니다.");
    }
    await loadState();
    if(r.ok) props.onStopped?.();
    } catch(e) {setErr(`종료 상태를 확인하지 못했습니다. 다시 시도해 주세요: ${(e as Error).message}`);}finally{setFinishing(false);}
  }

  /**
   * 확정: 전체 녹음을 파일 전체 화자분리로 다시 전사하고(회의 중 조각 화자는 잠정), 회의 전체를 일괄 분석한다.
   * 회의 중에 사람이 손댄 안건이 있으면 서버가 409 로 묻고, 동의하면 다시 보낸다.
   */
  async function finalize(confirmReplace = false) {
    setFinalizing(true);
    setErr(null);
    setStage("전체 녹음 다시 전사 중");
    try {
      const key = `scenenote-live-finalize:${props.meetingId}`;
      let jobId = localStorage.getItem(key);
      if (!jobId) {
        const r = await fetch(`/api/meetings/${props.meetingId}/live/finalize`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({confirmReplace})});
        const j = await r.json();
        if (r.status === 409 && j.code === "HUMAN_DECISIONS_EXIST" && window.confirm(`${j.error}\n확정할까요?`)) return finalize(true);
        if (!r.ok) throw new Error(j.error ?? "확정 준비 실패");
        jobId = j.jobId; localStorage.setItem(key, jobId!);
      }
      let retryFailed = true;
      for (;;) {
        const r = await fetch(`/api/meetings/${props.meetingId}/audio-transcribe`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({jobId, retryFailed})});
        retryFailed = false;
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "전사 실패. 성공 조각은 보존했습니다.");
        if (r.status !== 202) break;
        setStage(`전체 녹음 전사 ${j.completedChunks}/${j.totalChunks} 조각 저장됨`);
      }
      setStage("전사 완료 · 회의 전체 분석 중");
      const r = await fetch(`/api/meetings/${props.meetingId}/live/finalize`, {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({confirmReplace, transcriptionJobId:jobId})});
      const j = await r.json();
      if (r.status === 409 && j.code === "HUMAN_DECISIONS_EXIST" && window.confirm(`${j.error}\n확정할까요?`)) return finalize(true);
      if (!r.ok) throw new Error(j.error ?? "확정 분석 실패");
      localStorage.removeItem(key); window.location.href = `/m/${props.meetingId}/alignment`;
    } catch (e) { setErr((e as Error).message); }
    finally { setFinalizing(false); }
  }

  async function newMeeting() {
    if(props.newMeetingHref){window.location.href=props.newMeetingHref;return;}
    const r = await fetch(`/api/meetings/${props.meetingId}/live/new-meeting`, { method: "POST" });
    const j = await r.json();
    if (r.ok) window.location.href = `/m/${j.meetingId}/live`;
  }

  const recording = session?.status === "recording" || session?.status === "stopping";
  const sorted = sortIssues(Object.values(issues));
  const names = new Map<string, string>();
  for (const i of Object.values(issues)) for (const p of i.positions) if (p.speaker.key && p.speaker.name) names.set(p.speaker.key, p.speaker.name);

  return (
    <>
      {!props.embedded&&<LiveSharePanel meetingId={props.meetingId}/>}
      <div className={s.summary}>
        <div>
          <h1 className={s.title}>회의 중 화면</h1>
          <p className={s.sub}>
            조각({CHUNK_MS / 1000}초)마다 전사하고, 고정된 회의 목적에 맞춰 최근 대화를 확인합니다. 분석 시간이 더해져 표시되며 회의 중 판단은 잠정입니다.
          </p>
        </div>
        <div className={s.runInfo}>
          {finishing||session?.status==="stopping" ? <div role="status">녹음 종료 · 남은 전사·분석 처리 중</div> : recording ? (
            <>
              <div>
                <b style={{ color: "#dc2626" }}>● {session?.mode === "replay" ? "재생 중" : micActive ? "녹음 중" : session?.stoppedAt ? "녹음 종료 · 처리 재시도 필요" : "마이크 연결 없음"}</b> {clock(elapsed)} · 조각 {chunks.length} · {stage}
              </div>
              <button className={`${s.btn}`} onClick={stop} disabled={session?.status === "stopping"}>
                {session?.stoppedAt?"종료 처리 다시 시도":"정지"}
              </button>
            </>
          ) : session?.status === "stopped" ? (
            <>
              <div>정지됨 · 발언 {utts.length} · 안건 {sorted.length}</div>
              {facilitator ? <><button className={`${s.btn} ${s.btnPrimary}`} onClick={()=>void start("mic",true)}>같은 회의 이어서 녹음</button><button className={s.btn} onClick={newMeeting}>새 회의 시작</button></> : <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => finalize()} disabled={finalizing}>
                {finalizing ? "확정 분석 중 (몇 분 걸립니다)" : "회의 전체로 확정 분석"}
              </button>}
            </>
          ) : null}
        </div>
      </div>

      {err && <div className={s.error}>{err}</div>}
      {!!chunks.length&&<p className={s.muted}>서버 처리 완료 {chunks.filter(c=>c.status==="done").length}조각 · 대기 {chunks.filter(c=>c.status==="queued").length}조각 · 실패 {chunks.filter(c=>c.error).length}조각</p>}
      {chunks.some(c=>c.error)&&<div className={s.error}>전사 실패가 있어 이후 조각 처리를 보류했습니다. 원본 조각은 저장되어 있습니다. <button className={s.btn} onClick={recoverUploads}>전사 다시 시도</button></div>}
      {session?.status==="interrupted"&&session.stoppedAt&&<button className={s.btn} disabled={finishing} onClick={stop}>중단된 종료 처리 다시 시도</button>}
      {session?.mode==="mic"&&!micActive&&!session.stoppedAt&&["recording","interrupted"].includes(session.status)&&<button className={`${s.btn} ${s.btnPrimary}`} onClick={reconnectMic} style={{marginBottom:12}}>저장된 세션 복구 · 마이크 다시 연결</button>}
      {savedChunks>0&&<div className={s.detail} style={{marginBottom:12}}><span>브라우저에 저장된 녹음 {savedChunks}조각</span> <button className={s.btn} onClick={()=>downloadLiveChunks(props.meetingId)}>녹음 조각 내려받기</button> {recording&&!micActive&&<button className={s.btn} onClick={recoverUploads}>미전송 조각 복구</button>}</div>}
      {!recording&&!props.hasUtterances&&session?.status!=="stopped"&&<div className={s.detail} style={{marginBottom:16}}>
        <label><input type="checkbox" checked={facilitatorEnabled} onChange={e=>setFacilitatorEnabled(e.target.checked)}/> 회의 목적에 따른 진행 보조</label>
        {facilitatorEnabled&&<><label style={{display:"block",marginTop:12}}>오늘 결정할 회의 목적<textarea className={s.input} value={goal} onChange={e=>setGoal(e.target.value)} maxLength={1500} placeholder="예: 동상이몽의 첫 버전이 감지할 대상과 개입 조건을 정한다." rows={3}/></label><label>관찰 주기 <select className={s.input} style={{width:"auto"}} value={intervalMinutes} onChange={e=>setIntervalMinutes(Number(e.target.value))}>{[3,5,10].map(n=><option key={n} value={n}>{n}분</option>)}</select></label></>}
        <p className={s.muted}>마이크로 시작하면 녹음 조각이 OpenRouter로 전송되어 전사·분석됩니다. 목적은 시작 뒤 해당 세션 동안 고정됩니다.</p>
      </div>}

      {!recording && session?.status !== "stopped" && (
        <div className={s.detail} style={{ marginBottom: 16 }}>
          {props.hasUtterances ? (
            <>
              <p style={{ margin: "0 0 10px" }}>이 회의에는 이미 발언이 있습니다. 회의 중 입력은 빈 회의에서 시작합니다.</p>
              <button className={`${s.btn} ${s.btnPrimary}`} onClick={newMeeting}>
                같은 작품에 새 라이브 회의 만들기
              </button>
            </>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => start("mic")}>
                마이크로 회의 시작
              </button>
              {!props.embedded&&<><span className={s.muted}>또는</span>
              <label className={s.muted}>
                녹음 파일{" "}
                <select className={s.input} style={{ width: "auto" }} value={source} onChange={(e) => setSource(e.target.value)}>
                  {props.sources.length === 0 && <option value="">(재생할 파일 없음)</option>}
                  {props.sources.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={s.muted}>
                배속{" "}
                <select className={s.input} style={{ width: "auto" }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {[1, 2, 4].map((x) => (
                    <option key={x} value={x}>
                      ×{x}
                    </option>
                  ))}
                </select>
              </label>
              <button className={s.btn} onClick={() => start("replay")} disabled={!source}>
                재생 모드로 시작
              </button></>}
            </div>
          )}
        </div>
      )}

      <div className={s.grid} style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))" }}>
        <section className={s.list} aria-label="회의 중 발언">
          <div className={s.listHead}>
            발언 {utts.length}개 <span className={`${s.badge} ${s.warn}`}>잠정</span>
          </div>
          <div ref={listRef} style={{ maxHeight: 620, overflowY: "auto" }}>
            {utts.length === 0 && <p className={s.muted} style={{ padding: 14 }}>아직 들어온 발언이 없습니다.</p>}
            {utts.map((u) => (
              <div key={u.uid} id={`u_${u.uid}`} style={{ display: "grid", gridTemplateColumns: "54px 110px 1fr", gap: 8, padding: "7px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                <code className={s.muted}>{u.uid}</code>
                <span style={{ fontWeight: 700, color: u.speakerId ? "#1d4ed8" : "#94a3b8" }}>
                  {u.speakerName ?? (u.speakerId ? names.get(u.speakerId) ?? u.speakerId : "화자 미상")}
                  <div className={s.muted} style={{ fontWeight: 400 }}>
                    {clock(u.startMs)}
                  </div>
                </span>
                <span>{u.text}</span>
              </div>
            ))}
          </div>
        </section>

        {facilitatorEnabled||facilitator ? <FacilitatorPanel state={facilitator} meetingId={props.meetingId} decisionsHref={props.embedded?`/v2/m/${props.meetingId}/decisions`:undefined} onQuestion={props.onQuestion}/> : <section>
          <div className={s.listHead} style={{ borderRadius: "12px 12px 0 0", border: "1px solid #e2e8f0", borderBottom: 0, background: "#fff" }}>
            안건 {sorted.length}건 · 창 분석 {windows.length}회
            {windows.length > 0 && ` · 마지막 창 ${Math.round(windows[windows.length - 1].latencyMs / 1000)}초`}
          </div>
          <div className={s.list} style={{ borderRadius: "0 0 12px 12px" }}>
            {sorted.length === 0 && (
              <p className={s.muted} style={{ padding: 14 }}>
                {windows.length > 0 || session?.status === "stopped"
                  ? "창 분석에서 다시 확인할 안건을 찾지 못했습니다. 억지로 안건을 만들지 않습니다."
                  : "발언이 12개쯤 쌓이면 첫 분석을 돌립니다."}
              </p>
            )}
            {sorted.map((i) => (
              <div key={i.issue_id} className={`${s.item} ${flash[i.issue_id] ? s.itemActive : ""}`} style={{ cursor: "default" }}>
                <div className={s.itemTop}>
                  <span className={s.issueId}>{i.issue_id}</span>
                  <span className={`${s.badge} ${s[`sev_${i.severity}`]}`}>{SEVERITY_LABEL[i.severity]}</span>
                  <span className={`${s.badge} ${s.badgeType}`}>{ISSUE_TYPE_LABEL[i.type].label}</span>
                  <span className={`${s.badge} ${s[`st_${i.state}`]}`}>{ISSUE_STATE_LABEL[i.state]}</span>
                  {flash[i.issue_id] && <span className={`${s.badge} ${s.ok}`}>{flash[i.issue_id] === "new" ? "새 안건" : "갱신"}</span>}
                </div>
                <div className={s.itemTitle}>{i.decision}</div>
                <div style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>{i.question}</div>
                <div className={s.itemMeta}>
                  {i.positions.map((p) => speakerDisplay(p.speaker)).join(" · ")} · 근거 {i.evidence_all.slice(0, 6).join(", ")}
                  {i.evidence_all.length > 6 ? " …" : ""}
                </div>
              </div>
            ))}
          </div>
          {sorted.length > 0 && (
            <p style={{ marginTop: 10 }}>
              <a href={`/m/${props.meetingId}/alignment`} className={s.linkBtn}>
                다시 짚기 화면에서 근거와 함께 보기
              </a>
            </p>
          )}
          {chunks.some((c) => c.linkMethod === "unlinked") && (
            <div className={s.error}>화자 임베딩 사이드카가 꺼져 있어 조각 사이 화자 번호를 잇지 못했습니다. 화자는 조각별 번호(C1-…)로 표시됩니다.</div>
          )}
          {chunks.some((c) => c.error) && <div className={s.error}>전사 실패 조각 {chunks.filter((c) => c.error).length}개: {chunks.find((c) => c.error)?.error}</div>}
        </section>}
      </div>
    </>
  );
}
