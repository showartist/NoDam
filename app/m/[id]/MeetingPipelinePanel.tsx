"use client";

/**
 * 실제 파이프라인 패널: 오디오 업로드 → STT → 화자 이름 매핑 → 해석 차이 분석(v2).
 *
 * 성공/실패를 숨기지 않는다.
 *   - 전사 실패, 키 미설정, 분석 실패를 각각 다른 문구로 보여준다.
 *   - 화자분리가 지원되지 않으면 그렇다고 표시한다. 임의 화자를 만들지 않는다.
 *   - 분석을 돌린 적이 없으면 "실행 안 함"이다. 예시 결과를 대신 보여주지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import MicrophoneRecorder from "./MicrophoneRecorder";
import { AlignmentComparison } from "./alignment/AlignmentReviewBoard";
import type { AlignmentIssueV2 } from "@/lib/alignment/schema";
import type { AlignmentReviewSummary } from "@/lib/analysis/reviewSummary";

type Speaker = { speakerId: string; utteranceCount: number; displayName: string | null; role: string | null };
type IssueV2 = AlignmentIssueV2;
type Agreement = { topic: string; summary: string; evidence: string[]; condition: string | null };
type Analysis = {
  status: "not_run" | "completed" | "failed" | "running";
  run?: { model: string; judge_model: string | null; latency_ms: number | null; usage: { costUsd: number | null } | null } | null;
  error?: string | null;
  review?: AlignmentReviewSummary;
  utts?: Record<string, { uid: string; who: string; text: string }>;
  issues: IssueV2[];
  agreements: Agreement[];
};

const TYPE_LABEL: Record<string, string> = {
  interpretation_gap: "해석 차이",
  competing_alternatives: "대안 경쟁",
  decision_state_mismatch: "결정 상태 불일치",
  constraint_conflict: "제약 충돌",
  past_decision_conflict: "과거 결정 충돌",
  missing_information: "실행 정보 누락",
};
const STATE_LABEL: Record<string, string> = { open: "미결", conditional: "조건부 합의", agreed_candidate: "확정 후보", resolved: "감독 승인", dismissed: "제외" };

export default function MeetingPipelinePanel(props: { meetingId: string }) {
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  type Utt = { uid: string; speakerId: string | null; startMs: number | null; endMs: number | null; text: string };
  const [stt, setStt] = useState<
    { model: string; diarizationStatus: string; speakerCount: number | null; utteranceCount: number; utterances: Utt[]; method: string; chunkCount: number; speakerNote: string | null } | null
  >(null);
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [analysis, setAnalysis] = useState<Analysis>({ status: "not_run", issues: [], agreements: [] });

  const loadSpeakers = useCallback(async () => {
    const r = await fetch(`/api/meetings/${props.meetingId}/speakers`);
    if (r.ok) setSpeakers((await r.json()).speakers ?? []);
  }, [props.meetingId]);

  const loadAnalysis = useCallback(async () => {
    const r = await fetch(`/api/meetings/${props.meetingId}/analyze-v2`);
    if (r.ok) setAnalysis(await r.json());
  }, [props.meetingId]);

  useEffect(() => {
    void loadSpeakers();
    void loadAnalysis();
  }, [loadSpeakers, loadAnalysis]);

  const jobKey = `scenenote-transcription:${props.meetingId}`;
  const [pendingJob, setPendingJob] = useState<string | null>(null);
  useEffect(() => { setPendingJob(localStorage.getItem(jobKey)); }, [jobKey]);
  async function upload(file?: File) {
    setBusy("전사 중… (실제 음성을 OpenRouter STT로 보냅니다)");
    setErr(null);
    try {
    const endpoint = `/api/meetings/${props.meetingId}/audio-transcribe`;
    let r: Response;
    if (file) {
      const fd = new FormData(); fd.append("file", file);
      r = await fetch(endpoint, { method: "POST", body: fd });
    } else {
      r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: pendingJob, retryFailed: true }) });
    }
    let j = await r.json().catch(() => ({}));
    while (r.status === 202 && j.jobId) {
      localStorage.setItem(jobKey, j.jobId); setPendingJob(j.jobId);
      setBusy(`전사 조각 ${j.completedChunks}/${j.totalChunks} 완료 · 실패 ${j.failedChunks?.length ?? 0}개 · 성공 조각 저장됨`);
      r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: j.jobId }) });
      j = await r.json().catch(() => ({}));
    }
    setBusy(null);
    if (!r.ok || !j.success) {
      setErr({ code: j.code ?? `HTTP_${r.status}`, message: j.error ?? "전사에 실패했습니다." });
      return; // 기존 회의록은 서버에서 그대로 유지된다
    }
    localStorage.removeItem(jobKey); setPendingJob(null);
    setStt({
      model: j.model, diarizationStatus: j.diarizationStatus, speakerCount: j.speakerCount,
      method: j.method, chunkCount: j.chunkCount ?? 1, speakerNote: j.speakerNote ?? null,
      utteranceCount: j.utteranceCount, utterances: j.utterances ?? [],
    });
    setAnalysis({ status: "not_run", issues: [], agreements: [] });
    setSelectedIssue(null);
    await loadSpeakers();
    } catch (e) {
      setErr({ code: "NETWORK_ERROR", message: `전사 요청 실패: ${(e as Error).message}. 저장 여부는 회의 기록에서 확인하세요.` });
    } finally { setBusy(null); }
  }

  async function saveMapping(speakerId: string, displayName: string) {
    await fetch(`/api/meetings/${props.meetingId}/speakers`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mappings: [{ speakerId, displayName }] }),
    });
    await loadSpeakers();
  }

  const [extractInfo, setExtractInfo] = useState<{ ok: boolean; provider?: string; attempts?: number; message?: string } | null>(null);

  /** 발언에서 장면 명세(Scene Brief)·결정·미결정·의도를 뽑는다. 기존 장면 명세를 바꾸므로 먼저 묻는다. */
  async function extract(): Promise<void> {
    if (!window.confirm("이 회의의 발언으로 장면 명세를 새로 채웁니다. 기존 장면 명세 항목은 바뀝니다. 진행할까요?")) return;
    setBusy("장면 명세 추출 중 (실제 LLM 호출, 1~2분)");
    setErr(null);
    const r = await fetch(`/api/meetings/${props.meetingId}/extract`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setExtractInfo({ ok: false, message: j.error ?? `HTTP ${r.status}` });
      return;
    }
    setExtractInfo({ ok: true, provider: j.provider, attempts: (j.attempts ?? []).length });
  }

  async function analyze(confirmReplace = false): Promise<void> {
    setBusy("해석 차이 분석 중 (회의 전체 분석과 판정 모델 검사, 몇 분 걸릴 수 있습니다)");
    setErr(null);
    try {
    const r = await fetch(`/api/meetings/${props.meetingId}/analyze-v2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmReplace }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (r.status === 409 && j.code === "HUMAN_DECISIONS_EXIST") {
      if (window.confirm(`${j.error}\n\n그래도 다시 분석할까요?`)) return analyze(true);
      return;
    }
    if (!r.ok) {
      setErr({ code: j.code ?? `HTTP_${r.status}`, message: j.error ?? "분석에 실패했습니다." });
      setAnalysis({ status: "failed", error: j.error, issues: [], agreements: [] });
      return;
    }
    await loadAnalysis();
    } catch (e) {
      setErr({ code: "NETWORK_ERROR", message: `분석 응답 확인 실패: ${(e as Error).message}` });
    } finally { setBusy(null); }
  }

  return (
    <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18, marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
        🎙️ 회의 음성 → 전사 → 해석 차이 분석
      </h3>
      <p style={{ margin: "0 0 14px", fontSize: 11, color: "#94a3b8" }}>
        실제 OpenRouter API를 호출합니다. 실패하면 실패라고 표시하고 기존 회의록은 그대로 둡니다.
      </p>

      {/* 1. 업로드 */}
      <label style={{ display: "inline-block", background: "#2563eb", color: "#fff", padding: "8px 14px", borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
        오디오 파일 선택 (mp3 · m4a · wav)
        <input type="file" accept=".mp3,.m4a,.wav,.aac,.mp4,.webm,.ogg,.flac" style={{ display: "none" }}
          disabled={!!busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </label>

      <MicrophoneRecorder meetingId={props.meetingId} disabled={!!busy} onUpload={upload} />
      {pendingJob && !busy && <button onClick={() => void upload()}>중단된 전사 이어하기 · 실패 조각 재시도</button>}

      {busy && <div style={{ marginTop: 10, fontSize: 12, color: "#2563eb", fontWeight: 700 }}>⏳ {busy}</div>}

      {err && (
        <div data-testid="pipeline-error" style={{ marginTop: 10, background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "10px 12px" }}>
          <strong style={{ color: "#991b1b", fontSize: 12 }}>
            {err.code === "NOT_CONFIGURED" ? "설정 오류" : "실패"} · {err.code}
          </strong>
          <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 2 }}>{err.message}</div>
          <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 4 }}>실패 조각은 다시 시도할 수 있습니다. 응답이 끊겼다면 회의 기록에서 저장 여부를 확인하세요.</div>
        </div>
      )}

      {stt && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#334155" }}>
          ✅ 전사 완료 · 발언 {stt.utteranceCount}건 · 모델 <code>{stt.model}</code>
          <div style={{ fontSize: 11, color: stt.diarizationStatus === "ok" ? "#15803d" : "#c2410c", marginTop: 2 }}>
            {stt.diarizationStatus === "ok"
              ? `화자분리: ${stt.method.includes("sidecar") ? "사이드카" : "전사 공급자"} · ${stt.speakerCount ?? "?"}명 감지`
              : "⚠️ 회의 전체의 화자 구분을 확인하지 못했습니다. 조각별 번호는 같은 사람임을 보장하지 않습니다."}
          </div>

          <div>처리 조각 {stt.chunkCount}개 · {stt.speakerNote}</div>
          {stt.utterances.length > 0 && (
            <div data-testid="stt-transcript" style={{ marginTop: 10, maxHeight: 260, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
              {stt.utterances.map((u) => (
                <div key={u.uid} style={{ display: "flex", gap: 8, padding: "6px 10px", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                  <code style={{ color: "#94a3b8", flexShrink: 0 }}>{u.uid}</code>
                  <code style={{ flexShrink: 0, color: u.speakerId ? "#1d4ed8" : "#94a3b8", fontWeight: 700 }}>
                    {speakers.find(s => s.speakerId === u.speakerId)?.displayName ?? u.speakerId ?? "화자 미상"}
                  </code>
                  <span style={{ color: "#94a3b8", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                    {u.startMs != null ? `${(u.startMs / 1000).toFixed(1)}s` : "-"}
                  </span>
                  <span style={{ color: "#0f172a" }}>{u.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 2. 화자 이름 매핑 */}
      {speakers.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
          <h4 style={{ fontSize: 13, fontWeight: 800, margin: "0 0 8px" }}>화자 이름 지정</h4>
          {speakers.map((s) => (
            <div key={s.speakerId} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <code style={{ fontSize: 11, background: "#f1f5f9", padding: "3px 6px", borderRadius: 4 }}>{s.speakerId}</code>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{s.utteranceCount}건</span>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>→</span>
              <input key={`${s.speakerId}:${s.displayName}`} defaultValue={s.displayName ?? ""} placeholder="예: 대표"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.displayName) void saveMapping(s.speakerId, v); }}
                style={{ fontSize: 12, padding: "4px 8px", border: "1px solid #cbd5e1", borderRadius: 4, width: 140 }} />
            </div>
          ))}
        </div>
      )}

      {/* 3. 분석 */}
      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #f1f5f9" }}>
        <button onClick={() => void analyze()} disabled={!!busy}
          style={{ background: busy ? "#e2e8f0" : "#16a34a", color: busy ? "#94a3b8" : "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
          해석 차이 분석 실행
        </button>{" "}
        <button onClick={() => void extract()} disabled={!!busy}
          style={{ background: "#fff", color: busy ? "#94a3b8" : "#0f172a", border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: busy ? "wait" : "pointer" }}>
          장면 명세 추출
        </button>
        {extractInfo && (
          <div style={{ marginTop: 8, fontSize: 12, color: extractInfo.ok ? "#15803d" : "#991b1b" }} data-testid="extract-result">
            {extractInfo.ok
              ? `장면 명세를 채웠습니다 (${extractInfo.provider}, 시도 ${extractInfo.attempts}회). 새로고침하면 장면 명세 탭에 보입니다.`
              : `장면 명세 추출 실패: ${extractInfo.message}`}
          </div>
        )}

        {analysis.status === "not_run" && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#94a3b8" }} data-testid="analysis-not-run">
            아직 분석을 실행하지 않았습니다.
          </div>
        )}

        {analysis.status === "completed" && (
          <div style={{ marginTop: 12 }} data-testid="analysis-result">
            <div style={{ fontSize: 12, color: "#334155", fontWeight: 700, marginBottom: 8 }}>
              다시 확인할 안건 {analysis.issues.length}건 · 명시적 합의 {analysis.agreements.length}건
              {analysis.run && (
                <span style={{ fontWeight: 400, color: "#94a3b8" }}>
                  {" "}· {analysis.run.model}
                  {analysis.run.judge_model ? ` + 판정 ${analysis.run.judge_model}` : ""}
                  {analysis.run.usage?.costUsd != null ? ` · $${analysis.run.usage.costUsd.toFixed(2)}` : ""}
                </span>
              )}
            </div>

            {analysis.issues.length === 0 && (
              <div style={{ fontSize: 12, color: "#15803d", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "10px 12px" }}>
                검사를 통과한 안건이 없습니다. 없는 갈등을 만들지 않습니다.
              </div>
            )}

            {analysis.review && <p data-testid="review-summary">확인 필요 안건 {analysis.review.pendingIssues}건 · 판정 커버리지 {analysis.review.coverage === null ? "비교 항목 없음" : `${analysis.review.coverage}%`} · 판정 {analysis.review.compared}쌍 · 미판정 {analysis.review.unknown}쌍</p>}
            {analysis.issues.length > 0 && <>
              <label>비교할 안건 <select value={selectedIssue ?? analysis.issues[0].issue_id} onChange={e => setSelectedIssue(e.target.value)}>
                {analysis.issues.map(i => <option key={i.issue_id} value={i.issue_id}>{i.decision}</option>)}
              </select></label>
              <AlignmentComparison meetingId={props.meetingId} issue={analysis.issues.find(i => i.issue_id === selectedIssue) ?? analysis.issues[0]} utts={analysis.utts ?? {}} />
            </>}
            {analysis.issues.slice(0, 8).map((it) => (
              <div key={it.issue_id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                <code style={{ color: "#64748b", fontWeight: 800 }}>{it.issue_id}</code>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8" }}>{TYPE_LABEL[it.type] ?? it.type}</span>
                <span style={{ fontSize: 11, color: "#92400e" }}>{STATE_LABEL[it.state] ?? it.state}</span>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>{it.decision}</span>
              </div>
            ))}
            <a href={`/m/${props.meetingId}/alignment`} style={{ display: "inline-block", marginTop: 8, fontSize: 12, fontWeight: 800, color: "#2563eb" }}>
              다시 짚기 화면에서 근거와 함께 보기 →
            </a>
          </div>
        )}

        {analysis.status === "failed" && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#991b1b" }} data-testid="analysis-failed">
            분석 실패: {analysis.error}
          </div>
        )}
      </div>
    </section>
  );
}
