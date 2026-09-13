"use client";

/**
 * 3단계 "관점 비교" v2.
 *
 * 사람마다 입장과 그 사람이 상상한 그림(관점별 이미지)을 나란히 두고, 장면 항목마다 누구의 값을 쓸지
 * 사람이 고른다. 고른 값은 초안으로 저장될 뿐 승인이 아니다. AI 가 미리 골라 두지 않는다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AlignmentIssueV2, SlotKey } from "@/lib/alignment/schema";
import { compareColumns, CONTEXT_LABEL, SLOT_LABEL, slotRows, speakerDisplay } from "@/lib/alignment/present";
import { EvidenceChips, type UttLite } from "./EvidenceChips";
import { IssueBadges } from "./IssueDetailV2";
import { ReferencePanel } from "./ReferencePanel";
import { SimilarityLine, useReferenceTitles } from "./SimilarityLine";
import s from "./v2.module.css";

export type SelectedValue = {
  slot: SlotKey;
  value: string;
  speakerKey: string | null;
  evidence: string[];
  source: "selected" | "typed";
};

export type ImageRow = {
  id: string;
  kind: string;
  speaker_key: string | null;
  status: string;
  model: string;
  resolution: string;
  error: string | null;
  created_at: string;
  similarity_json?: string | null;
};

/** 이미지 API 는 camelCase, 페이지 데이터(DB 행)는 snake_case 로 온다. 화면은 한 모양으로 쓴다. */
export function toImageRow(x: Record<string, unknown> | null | undefined): ImageRow | null {
  if (!x || typeof x.id !== "string") return null;
  const pick = (a: string, b: string) => (x[a] ?? x[b] ?? null) as string | null;
  return {
    id: x.id,
    kind: String(x.kind ?? ""),
    speaker_key: pick("speaker_key", "speakerKey"),
    status: String(x.status ?? ""),
    model: String(x.model ?? ""),
    resolution: String(x.resolution ?? ""),
    error: pick("error", "error"),
    created_at: String(pick("created_at", "createdAt") ?? ""),
    similarity_json: typeof x.similarity_json === "string" ? x.similarity_json : x.similarity ? JSON.stringify(x.similarity) : null,
  };
}

export function CompareBoardV2(props: {
  meetingId: string;
  runId: string;
  issue: AlignmentIssueV2;
  utts: Record<string, UttLite>;
  initialDraft: SelectedValue[];
  images: ImageRow[];
}) {
  const i = props.issue;
  const rows = useMemo(() => slotRows(i), [i]);
  const columns = useMemo(() => compareColumns(i), [i]);
  const [sel, setSel] = useState<Record<string, SelectedValue>>(() => Object.fromEntries(props.initialDraft.map((d) => [d.slot, d])));
  const [typed, setTyped] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.initialDraft.filter((d) => d.source === "typed").map((d) => [d.slot, d.value])),
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(props.initialDraft.length ? "saved" : "idle");
  const [images, setImages] = useState<ImageRow[]>(props.images);
  const [imgBusy, setImgBusy] = useState<Record<number, boolean>>({});
  const [imgErr, setImgErr] = useState<Record<number, string>>({});
  const first = useRef(true);
  const refTitles = useReferenceTitles(props.meetingId, images.length);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      const r = await fetch(`/api/meetings/${props.meetingId}/issues-v2/${i.issue_id}/draft`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: props.runId, selected: Object.values(sel) }),
      });
      setSaveState(r.ok ? "saved" : "error");
    }, 400);
    return () => clearTimeout(t);
  }, [sel, props.meetingId, props.runId, i.issue_id]);

  function pick(slot: SlotKey, speakerKey: string, value: string, evidence: string[]) {
    setSel((prev) => {
      const cur = prev[slot];
      if (cur && cur.source === "selected" && cur.speakerKey === speakerKey) {
        const { [slot]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [slot]: { slot, value, speakerKey, evidence, source: "selected" } };
    });
  }

  function typeValue(slot: SlotKey, value: string) {
    setTyped((p) => ({ ...p, [slot]: value }));
    setSel((prev) => {
      if (!value.trim()) {
        if (prev[slot]?.source !== "typed") return prev;
        const { [slot]: _drop, ...rest } = prev;
        return rest;
      }
      return { ...prev, [slot]: { slot, value: value.trim(), speakerKey: null, evidence: [], source: "typed" } };
    });
  }

  async function generate(positionIndex: number) {
    setImgBusy((b) => ({ ...b, [positionIndex]: true }));
    setImgErr((e) => ({ ...e, [positionIndex]: "" }));
    const r = await fetch(`/api/images/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingId: props.meetingId, issueId: i.issue_id, runId: props.runId, positionIndex, resolution: "draft" }),
    });
    const j = await r.json().catch(() => ({}));
    setImgBusy((b) => ({ ...b, [positionIndex]: false }));
    if (!r.ok) {
      setImgErr((e) => ({ ...e, [positionIndex]: j.error ?? j.message ?? `이미지 생성 실패 (HTTP ${r.status})` }));
      return;
    }
    const row = toImageRow(j.image);
    if (row) setImages((xs) => [row, ...xs.filter((x) => x.id !== row.id)]);
  }

  /** 넘어가기 전에 마지막 선택을 저장한다(자동 저장 대기 중에 떠나도 잃지 않게). */
  async function goResolve() {
    await fetch(`/api/meetings/${props.meetingId}/issues-v2/${i.issue_id}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: props.runId, selected: Object.values(sel) }),
    });
    window.location.href = `/m/${props.meetingId}/alignment/${i.issue_id}/resolve`;
  }

  const chosen = rows.filter((r) => sel[r.slot]).length;

  return (
    <>
      <div className={s.summary}>
        <div>
          <div className={s.detailHead}>
            <span className={s.issueId}>{i.issue_id}</span>
            <IssueBadges issue={i} />
          </div>
          <h1 className={s.title}>{i.decision}</h1>
          <p className={s.sub}>같은 안건을 사람마다 어떻게 상상했는지 나란히 놓았습니다. 항목마다 쓸 값을 고르면 합의 화면으로 넘어갑니다.</p>
        </div>
        <a className={s.btn} href={`/m/${props.meetingId}/alignment`}>
          안건 목록으로
        </a>
      </div>
      <p className={s.question}>{i.question}</p>

      <div className={s.persons}>
        {i.positions.map((p, idx) => {
          const key = p.speaker.key ?? "?";
          const img = images.find((x) => x.kind === "perspective" && x.speaker_key === key && x.status === "completed");
          const pending = images.find((x) => x.kind === "perspective" && x.speaker_key === key && x.status === "generating");
          return (
            <section key={key} className={s.person} aria-label={speakerDisplay(p.speaker)}>
              <div className={s.personName}>{speakerDisplay(p.speaker)}</div>
              <div className={s.meaning}>{p.meaning}</div>
              <q className={s.quote}>{p.quote}</q>
              <div>
                <EvidenceChips meetingId={props.meetingId} uids={p.evidence} utts={props.utts} />
              </div>
              <div className={s.checkRow}>
                <span className={`${s.badge} ${p.checks.context === "supported" ? s.ok : p.checks.context === "partial" ? s.warn : ""}`} title={p.checks.contextNote ?? undefined}>
                  {CONTEXT_LABEL[p.checks.context]}
                </span>
              </div>
              <div className={s.imageBox}>
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/images/${img.id}`} alt={`${speakerDisplay(p.speaker)}이 상상한 장면 (생성 이미지)`} />
                ) : imgBusy[idx] || pending ? (
                  <span role="status">이미지 생성 중</span>
                ) : (
                  <span>아직 그리지 않았습니다</span>
                )}
              </div>
              {img && (
                <>
                  <div className={s.imageMeta}>
                    생성 이미지 · <code>{img.model}</code> · {img.resolution === "draft" ? "초안" : "최종"} · 근거 {p.evidence.join(", ")}
                  </div>
                  <SimilarityLine json={img.similarity_json} titles={refTitles} />
                </>
              )}
              {imgErr[idx] && <div className={s.error}>{imgErr[idx]}</div>}
              <button className={s.btn} onClick={() => generate(idx)} disabled={!!imgBusy[idx]}>
                {img ? "다시 그리기" : "이 사람의 그림 그리기"}
              </button>
            </section>
          );
        })}
        {i.past_decisions.map((d) => (
          <section key={d.ledger_id} className={s.person} aria-label="지난 회의 결정">
            <div className={s.personName}>지난 회의 결정</div>
            <div className={s.meaning}>
              {SLOT_LABEL[d.slot as SlotKey] ?? d.slot}: {d.value}
            </div>
            <p className={s.muted}>
              {d.meeting_title ?? `${d.meeting_id} 회의`}에서 승인해 결정 원장에 들어간 값입니다{d.decided_by ? ` (승인: ${d.decided_by})` : ""}. 되돌리려면
              아래 표에서 이 값을 고르세요.
            </p>
            <div className={s.checkRow}>
              <span className={`${s.badge} ${s.ok}`}>승인된 값</span>
            </div>
          </section>
        ))}
      </div>

      <ReferencePanel meetingId={props.meetingId} />

      <div className={s.section} style={{ marginTop: 22 }}>
        <h3 className={s.sectionTitle}>항목마다 쓸 값 고르기</h3>
        {rows.length === 0 ? (
          <p className={s.muted}>이 안건에서 장면 항목 값을 말한 사람이 없습니다. 합의 화면에서 직접 적어 주세요.</p>
        ) : (
          <table className={s.table}>
            <thead>
              <tr>
                <th>항목</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>직접 입력</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slot}>
                  <td className={s.who}>
                    {r.label}
                    {r.state === "differs" && <div className={s.diffDiffers}>값이 다름</div>}
                  </td>
                  {columns.map((c) => {
                    const key = c.key;
                    const v = r.values.find((x) => x.speakerKey === key)?.value;
                    if (!v) {
                      return (
                        <td key={key}>
                          <span className={s.cellEmpty}>말하지 않음</span>
                        </td>
                      );
                    }
                    const on = sel[r.slot]?.source === "selected" && sel[r.slot]?.speakerKey === key;
                    return (
                      <td key={key}>
                        <button
                          className={`${s.cell} ${on ? s.cellSelected : ""}`}
                          aria-pressed={on}
                          onClick={() => pick(r.slot, key, v, c.evidence)}
                        >
                          {on ? "✓ " : ""}
                          {v}
                        </button>
                      </td>
                    );
                  })}
                  <td>
                    <input
                      className={s.input}
                      value={typed[r.slot] ?? ""}
                      placeholder="다른 값으로 정하기"
                      onChange={(e) => typeValue(r.slot, e.target.value)}
                      aria-label={`${r.label} 직접 입력`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={s.footerBar}>
        <span className={s.muted}>
          고른 항목 {chosen}/{rows.length} ·{" "}
          {saveState === "saving" ? "저장 중" : saveState === "saved" ? "초안 저장됨 (승인 아님)" : saveState === "error" ? "저장 실패" : "아직 고르지 않음"}
        </span>
        <button className={`${s.btn} ${s.btnPrimary}`} onClick={goResolve}>
          합의 화면으로
        </button>
      </div>
    </>
  );
}
