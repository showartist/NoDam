"use client";

/**
 * 생성 이미지가 레퍼런스를 얼마나 닮았는지(계획서 3-1). 요청한 반영 수준과 사이드카가 잰 유사도를 나란히 적는다.
 * 사이드카가 꺼져 있었거나 쓴 레퍼런스 이미지가 없으면 "재지 않음"과 그 이유를 적고, 값을 추정해 채우지 않는다.
 */
import { useEffect, useState } from "react";
import s from "./v2.module.css";

const ADOPTION: Record<string, string> = { core: "핵심 반영", partial: "부분 반영", reference: "참고", excluded: "제외" };

const REASON: Record<string, string> = {
  no_reference_images: "쓴 레퍼런스 이미지가 없음",
  sidecar_unreachable: "사이드카가 꺼져 있었음",
};

type Record_ =
  | { status: "checked"; model: string | null; items: { reference_id: string; adoption: string; attached: boolean; similarity: number | null }[] }
  | { status: "not_checked"; reason?: string }
  | { status: "failed"; error: string };

function parse(json: string | null | undefined): Record_ | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Record_;
    return v && typeof v === "object" && "status" in v ? v : null;
  } catch {
    return null;
  }
}

/** 이 회의 레퍼런스의 제목. 새 이미지가 생기면(키가 바뀌면) 다시 읽는다. */
export function useReferenceTitles(meetingId: string, refreshKey: unknown): Record<string, string> {
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    void fetch(`/api/meetings/${meetingId}/visual-references`)
      .then((r) => (r.ok ? r.json() : { references: [] }))
      .then((j: { references?: { id: string; title: string }[] }) => {
        if (alive) setTitles(Object.fromEntries((j.references ?? []).map((x) => [x.id, x.title])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [meetingId, refreshKey]);
  return titles;
}

export function SimilarityLine(props: { json: string | null | undefined; titles: Record<string, string> }) {
  const r = parse(props.json);
  if (!r) return null;
  if (r.status === "not_checked") {
    const why = r.reason ? (REASON[r.reason] ?? (r.reason.startsWith("sidecar") ? "사이드카에 닿지 못함" : r.reason)) : "";
    return <div className={s.imageMeta}>레퍼런스 유사도 재지 않음{why ? ` · ${why}` : ""}</div>;
  }
  if (r.status === "failed") return <div className={s.imageMeta}>레퍼런스 유사도 측정 실패 · {r.error}</div>;
  const items = r.items;
  if (!items.length) return <div className={s.imageMeta}>레퍼런스 유사도 재지 않음 · 쓴 레퍼런스 이미지가 없음</div>;
  return (
    <div className={s.imageMeta} title={`${r.model ?? "이미지 임베딩"} 코사인 유사도. 요청한 반영 수준과 나란히 봅니다.`}>
      레퍼런스 유사도{" "}
      {items.map((it, n) => (
        <span key={it.reference_id}>
          {n > 0 && " · "}
          {props.titles[it.reference_id] ?? it.reference_id} ({ADOPTION[it.adoption] ?? it.adoption} 요청{it.attached ? "" : ", 이미지 입력 안 함"}){" "}
          <b>{it.similarity === null ? "값 없음" : it.similarity.toFixed(2)}</b>
        </span>
      ))}
    </div>
  );
}
