"use client";

/**
 * 4단계 "합의" v2.
 *
 * 관점 비교에서 고른 값을 보여 주고, 사람이 이름을 적고 승인해야 안건이 해결된다.
 * 승인하면 항목 값이 결정 원장에 들어가고, 다음 회의의 일관성 검사 기준이 된다.
 * AI 가 대신 채운 값은 없다. 역할별 영향 문장만 "제안" 배지와 함께 보여 준다.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AlignmentIssueV2, SlotKey } from "@/lib/alignment/schema";
import { isLedgerKey, SLOT_LABEL, slotRows, speakerDisplay } from "@/lib/alignment/present";
import { EvidenceChips, type UttLite } from "./EvidenceChips";
import { IssueBadges } from "./IssueDetailV2";
import { toImageRow, type ImageRow, type SelectedValue } from "./CompareBoardV2";
import { SimilarityLine, useReferenceTitles } from "./SimilarityLine";
import s from "./v2.module.css";

export type ResolutionView = {
  selected: SelectedValue[];
  summary: string;
  resolved_by: string;
  resolved_at: string;
};

export function ResolveBoardV2(props: {
  meetingId: string;
  runId: string;
  issue: AlignmentIssueV2;
  utts: Record<string, UttLite>;
  draft: SelectedValue[];
  resolution: ResolutionView | null;
  images: ImageRow[];
  shots: { id: string; shot_number: number; shot_size: string; image_state: string }[];
}) {
  const router = useRouter();
  const i = props.issue;
  const rows = useMemo(() => slotRows(i), [i]);
  const nameOf = (key: string | null) => {
    if (!key) return "직접 입력";
    if (isLedgerKey(key)) return "지난 회의 결정";
    const p = i.positions.find((x) => x.speaker.key === key);
    return p ? speakerDisplay(p.speaker) : key;
  };

  const [extra, setExtra] = useState<Record<string, string>>({});
  const selected: SelectedValue[] = useMemo(() => {
    const base = [...props.draft];
    for (const [slot, value] of Object.entries(extra)) {
      if (value.trim() && !base.some((b) => b.slot === slot)) {
        base.push({ slot: slot as SlotKey, value: value.trim(), speakerKey: null, evidence: [], source: "typed" });
      }
    }
    return base;
  }, [props.draft, extra]);
  const unselected = rows.filter((r) => !props.draft.some((d) => d.slot === r.slot));
  const autoSummary = selected.map((v) => `${SLOT_LABEL[v.slot]}: ${v.value}`).join(" / ");
  const [summary, setSummary] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRow[]>(props.images);
  const refTitles = useReferenceTitles(props.meetingId, images.length);
  const [imgBusy, setImgBusy] = useState(false);

  async function approve() {
    setErr(null);
    if (!by.trim()) {
      setErr("승인하는 사람 이름을 적어 주세요.");
      return;
    }
    if (selected.length === 0) {
      setErr("정한 항목이 없습니다. 관점 비교에서 값을 고르거나 아래에 직접 적어 주세요.");
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/meetings/${props.meetingId}/issues-v2/${i.issue_id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: props.runId, selected, summary: summary.trim() || autoSummary, resolvedBy: by.trim() }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? `승인하지 못했습니다 (HTTP ${r.status})`);
      return;
    }
    router.refresh();
  }

  async function consensusImage() {
    setImgBusy(true);
    setErr(null);
    const sel = props.resolution?.selected ?? selected;
    const r = await fetch(`/api/images/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingId: props.meetingId, issueId: i.issue_id, runId: props.runId, consensus: sel, resolution: "draft" }),
    });
    const j = await r.json().catch(() => ({}));
    setImgBusy(false);
    if (!r.ok) {
      setErr(j.error ?? j.message ?? `이미지 생성 실패 (HTTP ${r.status})`);
      return;
    }
    const row = toImageRow(j.image);
    if (row) setImages((xs) => [row, ...xs.filter((x) => x.id !== row.id)]);
  }

  const consensus = images.find((x) => x.kind === "consensus" && x.status === "completed");
  const [shotId, setShotId] = useState(props.shots[0]?.id ?? "");
  const [attached, setAttached] = useState(false);

  async function attach() {
    if (!consensus) return;
    const actor = window.prompt("쇼트에 붙이는 사람 이름");
    if (!actor?.trim()) return;
    const r = await fetch(`/api/shots/${shotId}/image`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageId: consensus.id, actor }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error ?? "쇼트에 붙이지 못했습니다.");
    else setAttached(true);
  }
  const shown = props.resolution?.selected ?? selected;

  return (
    <>
      <div className={s.summary}>
        <div>
          <div className={s.detailHead}>
            <span className={s.issueId}>{i.issue_id}</span>
            <IssueBadges issue={i} />
          </div>
          <h1 className={s.title}>{i.decision}</h1>
          <p className={s.sub}>{props.resolution ? "승인된 합의입니다." : "고른 값을 확인하고, 승인하는 사람이 이름을 적어 확정합니다."}</p>
        </div>
        <a className={s.btn} href={`/m/${props.meetingId}/alignment/${i.issue_id}/compare`}>
          관점 비교로 돌아가기
        </a>
      </div>

      <div className={s.gridResolve}>
        <div className={s.detail}>
          <h3 className={s.sectionTitle}>정한 값</h3>
          {shown.length === 0 ? (
            <p className={s.muted}>아직 고른 값이 없습니다.</p>
          ) : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th>항목</th>
                  <th>값</th>
                  <th>누구의 값</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.slot}>
                    <td className={s.who}>{SLOT_LABEL[v.slot]}</td>
                    <td>{v.value}</td>
                    <td>{nameOf(v.speakerKey)}</td>
                    <td>
                      {v.evidence.length ? (
                        <EvidenceChips meetingId={props.meetingId} uids={v.evidence} utts={props.utts} />
                      ) : (
                        <span className={s.muted}>{isLedgerKey(v.speakerKey) ? "지난 회의에서 승인된 값" : "회의 중 발언 아님"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!props.resolution && unselected.length > 0 && (
            <div className={s.section}>
              <h3 className={s.sectionTitle}>아직 고르지 않은 항목</h3>
              <p className={s.muted}>비워 두면 "이번 합의에서 정하지 않음"으로 기록됩니다.</p>
              {unselected.map((r) => (
                <label key={r.slot} style={{ display: "block", marginTop: 8 }}>
                  <span className={s.who}>{r.label}</span>{" "}
                  <span className={s.muted}>({r.values.map((v) => `${nameOf(v.speakerKey)}: ${v.value}`).join(" / ")})</span>
                  <input className={s.input} value={extra[r.slot] ?? ""} onChange={(e) => setExtra((x) => ({ ...x, [r.slot]: e.target.value }))} />
                </label>
              ))}
            </div>
          )}

          {props.resolution ? (
            <div className={s.section}>
              <div className={s.condition} style={{ borderStyle: "solid", borderColor: "#16a34a", background: "#f0fdf4", color: "#14532d" }}>
                <b>감독 승인</b> {props.resolution.resolved_by} · {new Date(props.resolution.resolved_at).toLocaleString("ko-KR")}
                <div style={{ marginTop: 4 }}>{props.resolution.summary}</div>
              </div>
            </div>
          ) : (
            <div className={s.section}>
              <h3 className={s.sectionTitle}>합의 문장</h3>
              <textarea className={s.textarea} value={summary} placeholder={autoSummary || "합의한 내용을 한두 문장으로"} onChange={(e) => setSummary(e.target.value)} />
              <label style={{ display: "block", marginTop: 10 }}>
                <span className={s.who}>승인하는 사람</span>
                <input className={s.input} value={by} placeholder="예: 박재인 (감독)" onChange={(e) => setBy(e.target.value)} />
              </label>
              {err && <div className={s.error}>{err}</div>}
              <div className={s.actions}>
                <button className={`${s.btn} ${s.btnApprove}`} onClick={approve} disabled={busy}>
                  {busy ? "승인 저장 중" : "승인"}
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className={s.detail}>
          <h3 className={s.sectionTitle}>합의 이미지</h3>
          <div className={s.imageBox}>
            {consensus ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/images/${consensus.id}`} alt="합의한 값으로 그린 장면 (생성 이미지)" />
            ) : imgBusy ? (
              <span role="status">이미지 생성 중</span>
            ) : (
              <span>{props.resolution ? "합의한 값으로 한 장 그릴 수 있습니다" : "승인한 뒤에 그립니다"}</span>
            )}
          </div>
          {consensus && (
            <>
              <div className={s.imageMeta}>
                생성 이미지 · <code>{consensus.model}</code> · 입력은 위 표의 값과 근거 발언뿐입니다
              </div>
              <SimilarityLine json={consensus.similarity_json} titles={refTitles} />
            </>
          )}
          {props.resolution && (
            <div className={s.actions}>
              <button className={s.btn} onClick={consensusImage} disabled={imgBusy}>
                {consensus ? "다시 그리기" : "합의 이미지 그리기"}
              </button>
            </div>
          )}
          {props.resolution && err && <div className={s.error}>{err}</div>}

          {props.resolution && consensus && props.shots.length > 0 && (
            <div className={s.section}>
              <h3 className={s.sectionTitle}>Shot Board 에 붙이기</h3>
              <p className={s.muted}>붙인 쇼트는 다시 승인 대기가 됩니다. 쇼트 승인은 최종 제작안 화면에서 합니다.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                <select className={s.input} style={{ width: "auto" }} value={shotId} onChange={(e) => setShotId(e.target.value)} aria-label="붙일 쇼트">
                  {props.shots.map((sh) => (
                    <option key={sh.id} value={sh.id}>
                      SHOT {String(sh.shot_number).padStart(2, "0")} · {sh.shot_size} · {sh.image_state === "generated" ? "이미지 있음" : "이미지 없음"}
                    </option>
                  ))}
                </select>
                <button className={s.btn} onClick={attach} disabled={!shotId}>
                  이 쇼트에 붙이기
                </button>
                {attached && <span className={`${s.badge} ${s.ok}`}>붙임 · 승인 대기</span>}
              </div>
            </div>
          )}

          {Object.keys(i.role_briefs).length > 0 && (
            <div className={s.section}>
              <h3 className={s.sectionTitle}>
                역할마다 바뀌는 것 <span className={`${s.badge} ${s.badgeAi}`}>제안</span>
              </h3>
              <ul className={s.briefs}>
                {Object.entries(i.role_briefs).map(([role, text]) => (
                  <li key={role}>
                    <span className={s.briefRole}>{role}</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
