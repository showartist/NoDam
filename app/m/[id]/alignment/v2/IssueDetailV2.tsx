"use client";

/**
 * 안건 하나의 상세. 다시 짚기·관점 비교·합의 화면이 같은 조각을 쓴다.
 * 입장과 항목 비교는 표로 보여 준다(목록형 데이터를 카드로 감싸지 않는다 — UI 검수 D).
 */
import type { AlignmentIssueV2 } from "@/lib/alignment/schema";
import {
  compareColumns,
  CONTEXT_LABEL,
  ISSUE_STATE_LABEL,
  ISSUE_TYPE_LABEL,
  SEVERITY_LABEL,
  SLOT_LABEL,
  slotRows,
  speakerDisplay,
} from "@/lib/alignment/present";
import { EvidenceChips, type UttLite } from "./EvidenceChips";
import s from "./v2.module.css";

export function IssueBadges(props: { issue: AlignmentIssueV2 }) {
  const i = props.issue;
  return (
    <>
      <span className={`${s.badge} ${s[`sev_${i.severity}`]}`}>{SEVERITY_LABEL[i.severity]}</span>
      <span className={`${s.badge} ${s.badgeType}`} title={ISSUE_TYPE_LABEL[i.type].todo}>
        {ISSUE_TYPE_LABEL[i.type].label}
      </span>
      <span className={`${s.badge} ${s[`st_${i.state}`]}`}>{ISSUE_STATE_LABEL[i.state]}</span>
    </>
  );
}

export function IssueDetailV2(props: {
  meetingId: string;
  issue: AlignmentIssueV2;
  utts: Record<string, UttLite>;
  compact?: boolean;
}) {
  const i = props.issue;
  const rows = slotRows(i);
  const columns = compareColumns(i);

  return (
    <div>
      <div className={s.detailHead}>
        <span className={s.issueId}>{i.issue_id}</span>
        <IssueBadges issue={i} />
        {i.data_mode === "fixture" && <span className={`${s.badge} ${s.warn}`}>데모 픽스처</span>}
      </div>
      <h2 className={s.decision}>{i.decision}</h2>
      {i.concept && <p className={s.concept}>갈린 표현: {i.concept}</p>}
      <p className={s.question}>{i.question}</p>
      <p className={s.why}>
        <b>할 일</b> {ISSUE_TYPE_LABEL[i.type].todo}. {i.why_it_matters}
      </p>
      {i.condition && (
        <div className={s.condition}>
          <b>남은 조건</b> {i.condition.text}{" "}
          <EvidenceChips meetingId={props.meetingId} uids={i.condition.evidence} utts={props.utts} />
        </div>
      )}

      <div className={s.section}>
        <h3 className={s.sectionTitle}>사람마다 뜻한 것</h3>
        <table className={s.table}>
          <thead>
            <tr>
              <th>누가</th>
              <th>뜻한 것</th>
              {!props.compact && <th>인용</th>}
              <th>근거</th>
              <th>검사</th>
            </tr>
          </thead>
          <tbody>
            {i.positions.map((p) => (
              <tr key={p.speaker.key ?? p.quote}>
                <td className={s.who}>{speakerDisplay(p.speaker)}</td>
                <td>{p.meaning}</td>
                {!props.compact && (
                  <td>
                    <q className={s.quote}>{p.quote}</q>
                  </td>
                )}
                <td>
                  <EvidenceChips meetingId={props.meetingId} uids={p.evidence} utts={props.utts} />
                </td>
                <td>
                  <span className={s.checkInline}>
                    <span className={`${s.badge} ${s.ok}`} title="근거 발언 중에 이 사람이 직접 한 발언이 있고, 인용 구절이 그 원문에 있음">
                      화자·인용 확인
                    </span>
                    <span
                      className={`${s.badge} ${p.checks.context === "supported" ? s.ok : p.checks.context === "partial" ? s.warn : ""}`}
                      title={p.checks.contextNote ?? undefined}
                    >
                      {CONTEXT_LABEL[p.checks.context]}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className={s.section}>
          <h3 className={s.sectionTitle}>장면 항목 비교</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th>항목</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th>비교</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slot}>
                  <td className={s.who}>{r.label}</td>
                  {columns.map((c) => (
                    <td key={c.key}>{r.values.find((v) => v.speakerKey === c.key)?.value ?? <span className={s.muted}>말하지 않음</span>}</td>
                  ))}
                  <td>
                    {r.state === "single" ? (
                      <span className={s.muted}>한 사람만 말함</span>
                    ) : r.state === "differs" ? (
                      <span className={s.diffDiffers}>다름</span>
                    ) : (
                      <span className={s.diffSame}>같음</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={s.distance}>
            <strong>해석 거리 {i.distance.value === null ? "계산 안 함" : `${i.distance.differs}/${i.distance.compared}`}</strong>
            {i.distance.basis}
          </p>
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

      {i.past_decisions.length > 0 && (
        <div className={s.section}>
          <h3 className={s.sectionTitle}>대조한 과거 결정</h3>
          <ul className={s.slotList}>
            {i.past_decisions.map((d) => (
              <li key={d.ledger_id}>
                <span className={s.slotKey}>{SLOT_LABEL[d.slot as keyof typeof SLOT_LABEL] ?? d.slot}</span>
                {d.value}{" "}
                <span className={s.muted}>
                  ({d.meeting_title ?? `${d.meeting_id} 회의`}
                  {d.decided_by ? ` · 승인: ${d.decided_by}` : ""} · 근거 {d.evidence.join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(i.dropped.length > 0 || i.audit.length > 0) && (
        <details className={s.log}>
          <summary>검사 기록 {i.dropped.length + i.audit.length}건</summary>
          <ul>
            {i.dropped.map((d, n) => (
              <li key={`d${n}`}>
                떨어진 입장({d.speaker}): {d.reason} {d.evidence.length > 0 && <EvidenceChips meetingId={props.meetingId} uids={d.evidence} utts={props.utts} />}
              </li>
            ))}
            {i.audit.map((a, n) => (
              <li key={`a${n}`}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
