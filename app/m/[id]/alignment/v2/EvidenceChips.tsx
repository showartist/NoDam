"use client";

/**
 * 근거 칩. 누르면 회의 기록의 그 발언으로 이동하고, 마우스를 올리거나 키보드로 초점을 주면 원문이 뜬다.
 * 회의에 없는 번호는 빨간 칩으로 "근거 없음"을 드러낸다(조용히 숨기지 않는다).
 */
import { useState } from "react";
import s from "./v2.module.css";

export type UttLite = { uid: string; who: string; text: string };

export function EvidenceChips(props: { meetingId: string; uids: string[]; utts: Record<string, UttLite> }) {
  if (props.uids.length === 0) {
    return <span className={`${s.chip} ${s.chipMissing}`}>근거 없음</span>;
  }
  return (
    <span className={s.chips}>
      {props.uids.map((u) => (
        <Chip key={u} meetingId={props.meetingId} uid={u} utt={props.utts[u]} />
      ))}
    </span>
  );
}

function Chip(props: { meetingId: string; uid: string; utt?: UttLite }) {
  const [open, setOpen] = useState(false);
  if (!props.utt) {
    return <span className={`${s.chip} ${s.chipMissing}`} title="회의에 없는 발언 번호">{props.uid} 없음</span>;
  }
  return (
    <span className={s.chipWrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <a
        className={s.chip}
        href={`/m/${props.meetingId}?tab=transcript#u_${props.uid}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={`${props.uid} ${props.utt.who}: ${props.utt.text}`}
      >
        {props.uid}
      </a>
      {open && (
        <span className={s.pop} role="tooltip">
          <span className={s.popWho}>
            {props.uid} {props.utt.who}
          </span>
          {props.utt.text}
        </span>
      )}
    </span>
  );
}
