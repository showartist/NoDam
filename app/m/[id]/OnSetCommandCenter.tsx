"use client";

/**
 * 현장 지휘 센터: 녹음 업로드·전사·화자 매핑·해석 차이 분석 패널과, 현재 분석의 안건 요약.
 *
 * 이전 버전은 SCENE 34 의 발언·선택값("35mm 와이드 샷")·승인자("한지우(감독)")를 코드에 적어 두고
 * 합의 흐름 전체를 흉내 냈다. 다시 짚기·관점 비교·합의 화면이 실제 데이터로 동작하므로,
 * 여기서는 지금 회의에 무엇이 남았는지만 요약하고 해당 화면으로 보낸다.
 */
import MeetingPipelinePanel from "./MeetingPipelinePanel";
import type { AlignmentIssueV2 } from "@/lib/alignment/schema";
import { ISSUE_STATE_LABEL, ISSUE_TYPE_LABEL, SEVERITY_LABEL, sortIssues, speakerDisplay } from "@/lib/alignment/present";

export type OnSetAlignment = {
  runId: string;
  model: string;
  createdAt: string;
  issues: AlignmentIssueV2[];
};

const SEV_STYLE: Record<string, React.CSSProperties> = {
  critical: { border: "2px solid #dc2626", color: "#991b1b", background: "#fef2f2" },
  high: { border: "1px solid #fb923c", color: "#9a3412", background: "#fff7ed" },
  medium: { border: "1px solid #cbd5e1", color: "#334155", background: "#fff" },
  low: { border: "1px dashed #cbd5e1", color: "#64748b", background: "#fff" },
};

const badge: React.CSSProperties = { fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap" };

export function OnSetCommandCenter(props: { meetingId: string; alignment: OnSetAlignment | null }) {
  const issues = props.alignment ? sortIssues(props.alignment.issues) : [];
  const open = issues.filter((i) => i.state !== "resolved" && i.state !== "dismissed");

  return (
    <div style={{ width: "100%", color: "#0f172a", fontFamily: "-apple-system, BlinkMacSystemFont, Pretendard, sans-serif" }}>
      <MeetingPipelinePanel meetingId={props.meetingId} />

      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>
            {props.alignment ? `다시 확인할 안건 ${open.length}건` : "해석 차이 분석을 아직 돌리지 않았습니다"}
          </h3>
          <a href={`/m/${props.meetingId}/alignment`} style={{ fontSize: 12, fontWeight: 700, color: "#2563eb" }}>
            다시 짚기 화면에서 보기 →
          </a>
        </div>
        {props.alignment && (
          <p style={{ margin: "4px 0 12px", fontSize: 11, color: "#64748b" }}>
            분석 {new Date(props.alignment.createdAt).toLocaleString("ko-KR")} · <code>{props.alignment.model}</code>
          </p>
        )}
        {props.alignment && issues.length === 0 && (
          <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>검사를 통과한 안건이 없습니다. 억지로 안건을 만들지 않습니다.</p>
        )}
        {issues.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {issues.map((i) => (
                <tr key={i.issue_id} style={{ borderTop: "1px solid #f1f5f9", opacity: i.state === "resolved" || i.state === "dismissed" ? 0.6 : 1 }}>
                  <td style={{ padding: "8px 6px", fontWeight: 800, color: "#64748b", whiteSpace: "nowrap" }}>{i.issue_id}</td>
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    <span style={{ ...badge, ...SEV_STYLE[i.severity] }}>{SEVERITY_LABEL[i.severity]}</span>{" "}
                    <span style={{ ...badge, border: "1px solid #bfdbfe", color: "#1d4ed8", background: "#eff6ff" }}>{ISSUE_TYPE_LABEL[i.type].label}</span>{" "}
                    <span style={{ ...badge, border: "1px solid #cbd5e1", color: "#334155" }}>{ISSUE_STATE_LABEL[i.state]}</span>
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    <div style={{ fontWeight: 700 }}>{i.decision}</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>{i.question}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{i.positions.map((p) => speakerDisplay(p.speaker)).join(" · ")}</div>
                  </td>
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    <a href={`/m/${props.meetingId}/alignment/${i.issue_id}/compare`} style={{ fontSize: 12, color: "#2563eb", fontWeight: 700 }}>
                      관점 비교
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
