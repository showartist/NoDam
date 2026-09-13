"use client";

/**
 * 2단계 "다시 짚기" v2. 회의의 현재 분석(run)을 읽는다. 분석이 없으면 없다고 말하고,
 * 예시 안건으로 채우지 않는다.
 */
import { useMemo, useState } from "react";
import { summarizeAlignmentReview } from "@/lib/analysis/reviewSummary";
import { AlignmentComparison } from "../AlignmentReviewBoard";
import { useRouter } from "next/navigation";
import type { AgreementV2, AlignmentIssueV2 } from "@/lib/alignment/schema";
import { formatDuration, formatUsd, ISSUE_STATE_LABEL, sortIssues, speakerDisplay } from "@/lib/alignment/present";
import { EvidenceChips, type UttLite } from "./EvidenceChips";
import { IssueBadges, IssueDetailV2 } from "./IssueDetailV2";
import { RelatedPast } from "./RelatedPast";
import s from "./v2.module.css";

export type RunSummary = {
  id: string;
  status: string;
  mode: string;
  model: string;
  judge_model: string | null;
  latency_ms: number | null;
  created_at: string;
  error: string | null;
  costUsd: number | null;
  utterance_count: number | null;
};

export function ReviewBoardV2(props: {
  meetingId: string;
  run: RunSummary | null;
  lastFailed: RunSummary | null;
  issues: AlignmentIssueV2[];
  agreements: AgreementV2[];
  utts: Record<string, UttLite>;
  utteranceCount: number;
}) {
  const router = useRouter();
  const sorted = useMemo(() => sortIssues(props.issues), [props.issues]);
  const [selected, setSelected] = useState<string | null>(sorted[0]?.issue_id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = sorted.find((i) => i.issue_id === selected) ?? sorted[0] ?? null;

  const review = summarizeAlignmentReview(props.issues);
  const open = props.issues.filter((i) => i.state !== "resolved" && i.state !== "dismissed");
  const critical = open.filter((i) => i.severity === "critical");
  const byState = (st: AlignmentIssueV2["state"]) => props.issues.filter((i) => i.state === st).length;

  async function analyze(confirmReplace = false) {
    setBusy("해석 차이 분석 중 (회의 전체 · 판정 모델 검사 포함, 몇 분 걸릴 수 있습니다)");
    setError(null);
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
      setError(`${j.code ?? `HTTP ${r.status}`}: ${j.error ?? "분석에 실패했습니다."}`);
      return;
    }
    router.refresh();
  }

  async function setState(issue: AlignmentIssueV2, state: "dismissed" | "open") {
    const actor = window.prompt(state === "dismissed" ? "이 안건을 제외하는 사람 이름" : "다시 여는 사람 이름");
    if (!actor?.trim()) return;
    const r = await fetch(`/api/meetings/${props.meetingId}/issues-v2/${issue.issue_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, actor, runId: props.run?.id }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? "상태를 바꾸지 못했습니다.");
      return;
    }
    router.refresh();
  }

  if (!props.run) {
    return (
      <div className={s.notice}>
        <h2>아직 이 회의를 분석하지 않았습니다</h2>
        <p>
          발언 {props.utteranceCount}개를 해석 차이 탐지 v2로 분석합니다. 회의 전체를 한 번에 읽고, 판정 모델이 입장마다 근거를 대조합니다.
          {props.utteranceCount === 0 && " 먼저 회의 기록 화면에서 녹음을 올려 주세요."}
        </p>
        {props.lastFailed && (
          <div className={s.error}>
            지난 분석 실패 ({new Date(props.lastFailed.created_at).toLocaleString("ko-KR")}): {props.lastFailed.error}
          </div>
        )}
        {error && <div className={s.error}>{error}</div>}
        {busy ? (
          <div className={s.busy} role="status">{busy}</div>
        ) : (
          <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => analyze()} disabled={props.utteranceCount === 0}>
            분석 실행
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className={s.summary}>
        <div>
          <h1 className={s.title}>다시 확인할 안건 {open.length}건</h1>
          <p className={s.sub}>같은 말을 다르게 이해했거나, 조건이 남았거나, 실행 정보가 빠진 지점입니다. 확정은 사람이 합니다.</p>
          <p data-testid="review-summary">확인 필요 안건 {review.pendingIssues}건 · 판정 커버리지 {review.coverage === null ? "비교 항목 없음" : `${review.coverage}%`} · 판정 {review.compared}쌍 · 미판정 {review.unknown}쌍</p>
          <div className={s.counts} style={{ marginTop: 10 }}>
            {(["open", "conditional", "agreed_candidate", "resolved", "dismissed"] as const).map((st) => (
              <span key={st}>
                <strong>{byState(st)}</strong>
                {ISSUE_STATE_LABEL[st]}
              </span>
            ))}
          </div>
        </div>
        <div className={s.runInfo}>
          <div>
            분석 {new Date(props.run.created_at).toLocaleString("ko-KR")} · 발언 {props.run.utterance_count ?? props.utteranceCount}개
          </div>
          <div>
            분석 모델 <code>{props.run.model}</code>
            {props.run.judge_model && (
              <>
                {" "}· 판정 <code>{props.run.judge_model}</code>
              </>
            )}
          </div>
          <div>
            걸린 시간 {formatDuration(props.run.latency_ms)} · 비용 {formatUsd(props.run.costUsd)} (OpenRouter 보고값)
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 12, justifyContent: "flex-end" }}>
            <a className={s.linkBtn} href={`/m/${props.meetingId}/history`}>
              결정 이력
            </a>
            <a className={s.linkBtn} href={`/m/${props.meetingId}/live`}>
              회의 중 화면
            </a>
            <a className={s.linkBtn} href={`/m/${props.meetingId}/characters`}>
              캐릭터 초안
            </a>
            {busy ? (
              <span className={s.busy} role="status">{busy}</span>
            ) : (
              <button className={s.linkBtn} onClick={() => analyze()}>
                다시 분석
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className={s.error}>{error}</div>}

      {critical.length > 0 && (
        <div className={s.blockBanner} role="alert">
          제작 차단 가능 안건 {critical.length}건: {critical.map((c) => `${c.issue_id} ${c.decision}`).join(" · ")}
        </div>
      )}

      {current && <AlignmentComparison meetingId={props.meetingId} issue={current} utts={props.utts} />}

      {sorted.length === 0 ? (
        <div className={s.notice}>
          <h2>검사를 통과한 안건이 없습니다</h2>
          <p>분석기가 낸 안건이 근거 검사에서 모두 떨어졌거나, 이 회의에 다시 확인할 지점이 없습니다. 억지로 안건을 만들지 않습니다.</p>
        </div>
      ) : (
        <div className={s.grid}>
          <div>
            <nav className={s.list} aria-label="안건 목록">
              <div className={s.listHead}>안건 {sorted.length}건 · 열린 것 먼저, 심각도 순</div>
              {sorted.map((i) => {
                const closed = i.state === "resolved" || i.state === "dismissed";
                return (
                  <button
                    key={i.issue_id}
                    className={`${s.item} ${current?.issue_id === i.issue_id ? s.itemActive : ""} ${closed ? s.itemClosed : ""}`}
                    onClick={() => setSelected(i.issue_id)}
                    aria-current={current?.issue_id === i.issue_id}
                  >
                    <div className={s.itemTop}>
                      <span className={s.issueId}>{i.issue_id}</span>
                      <IssueBadges issue={i} />
                    </div>
                    <div className={s.itemTitle}>{i.decision}</div>
                    <div className={s.itemMeta}>
                      {i.positions.map((p) => speakerDisplay(p.speaker)).join(" · ")}
                      {i.distance.value !== null &&
                        (i.distance.differs === 0 ? ` · 비교한 항목 ${i.distance.compared}개 모두 같음` : ` · 항목 ${i.distance.compared}개 중 ${i.distance.differs}개 다름`)}
                    </div>
                  </button>
                );
              })}
            </nav>

            {props.agreements.length > 0 && (
              <section className={s.agreements}>
                <h3 className={s.sectionTitle}>
                  명시적 합의 {props.agreements.length}건 <span className={`${s.badge} ${s.badgeAi}`}>확정 후보</span>
                </h3>
                <ul>
                  {props.agreements.map((a) => (
                    <li key={a.topic}>
                      <b>{a.topic}</b> {a.summary}{" "}
                      {a.condition && <span className={`${s.badge} ${s.warn}`}>조건 표현 있음: “{a.condition}”</span>}{" "}
                      <EvidenceChips meetingId={props.meetingId} uids={a.evidence} utts={props.utts} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {current && (
            <article className={s.detail}>
              <IssueDetailV2 meetingId={props.meetingId} issue={current} utts={props.utts} />
              <RelatedPast key={current.issue_id} meetingId={props.meetingId} query={`${current.decision} ${current.concept}`.trim()} />
              <div className={s.actions}>
                <a className={`${s.btn} ${s.btnPrimary}`} href={`/m/${props.meetingId}/alignment/${current.issue_id}/compare`}>
                  관점 비교로
                </a>
                {current.state === "resolved" ? (
                  <a className={s.btn} href={`/m/${props.meetingId}/alignment/${current.issue_id}/resolve`}>
                    승인 내용 보기
                  </a>
                ) : current.state === "dismissed" ? (
                  <button className={s.btn} onClick={() => setState(current, "open")}>
                    다시 열기
                  </button>
                ) : (
                  <button className={s.btn} onClick={() => setState(current, "dismissed")}>
                    이 안건 제외
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
      )}
    </>
  );
}
