"use client";

/**
 * 지난 회의에서 관련 발언 찾기. 누를 때만 검색한다(임베딩 호출 비용·지연이 있어서).
 * 점수는 임베딩 코사인 유사도이며, 관련 여부의 판정이 아니라 찾아본 순서다.
 */
import { useState } from "react";
import s from "./v2.module.css";

type Hit = { meetingId: string; meetingTitle: string | null; uid: string; speaker: string | null; text: string; score: number };

export function RelatedPast(props: { meetingId: string; query: string }) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/meetings/${props.meetingId}/related?q=${encodeURIComponent(props.query)}`);
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? "검색하지 못했습니다.");
      return;
    }
    setHits(j.hits ?? []);
  }

  return (
    <div className={s.section}>
      <h3 className={s.sectionTitle}>지난 회의에서 관련 발언</h3>
      {hits === null ? (
        <button className={s.linkBtn} onClick={run} disabled={busy}>
          {busy ? "찾는 중" : "같은 작품의 다른 회의에서 찾기"}
        </button>
      ) : hits.length === 0 ? (
        <p className={s.muted}>같은 작품의 다른 회의가 없거나, 가까운 발언이 없습니다.</p>
      ) : (
        <ul className={s.slotList}>
          {hits.map((h) => (
            <li key={`${h.meetingId}:${h.uid}`}>
              <a className={s.chip} href={`/m/${h.meetingId}?tab=transcript#u_${h.uid}`}>
                {h.uid}
              </a>{" "}
              <span className={s.muted}>{h.meetingTitle ?? h.meetingId} · {h.speaker ?? "화자 미상"}</span> {h.text}{" "}
              <span className={s.muted}>(유사도 {h.score.toFixed(2)})</span>
            </li>
          ))}
        </ul>
      )}
      {err && <div className={s.error}>{err}</div>}
    </div>
  );
}
