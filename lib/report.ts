// 회의 결과 문서 — 감독·작가·제작PD가 회의 직후 그대로 전달할 수 있는 형태.
// 화면 캡처가 아니라 데이터에서 조립한다. 근거가 없는 항목은 만들지 않는다.
import { getBundle } from "./store";
import { db } from "./db";
import { normalizeEvidence } from "./normalize";
import {
  COVERAGE_STATUS_LABEL,
  coverageRoleDisplayLabel,
  coverageStateDisplayLabel,
  INTENT_LABEL,
  SCENE_BRIEF_FIELDS,
  SCENE_BRIEF_LABEL,
  SCENE_ISSUE_LABEL,
  SLUGLINE_FIELDS,
  STATE_LABEL,
  type CoverageStatus,
  type DecisionState,
  type IntentType,
  type Role,
  type SceneBriefField,
  type SceneIssueType,
} from "./types";

export type ReportRole = Role;

const parse = <T,>(raw: string | null | undefined, fb: T): T => {
  if (!raw) return fb;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fb;
  }
};

export type ReportLine = { label: string; value: string; meta?: string };
export type ReportSection = { title: string; note?: string; lines: ReportLine[] };

export type MeetingReport = {
  project: string;
  slugline: string;
  oneLine: string | null;
  date: string;
  participants: { name: string; role: string | null }[];
  utteranceCount: number;
  role: ReportRole;
  common: ReportSection[];
  roleSections: ReportSection[];
  /** 사람이 확인해야 할 것 — 문서 맨 앞에 둔다 */
  actionItems: ReportLine[];
};

export function buildReport(meetingId: string, role: ReportRole = "all"): MeetingReport | null {
  const b = getBundle(meetingId);
  if (!b) return null;

  const brief = (f: SceneBriefField) =>
    b.briefItems.filter((x) => x.field === f).map((x) => ({ ...x, value: x.user_value ?? x.ai_value }));
  const briefLine = (f: SceneBriefField): ReportLine[] =>
    brief(f).map((x) => ({
      label: SCENE_BRIEF_LABEL[f],
      value: x.value,
      meta: [
        STATE_LABEL[x.decision_state as DecisionState] ?? x.decision_state,
        x.verification_state === "approved" ? `승인 ${x.approved_by ?? ""}`.trim() : null,
        normalizeEvidence(x.evidence, { meetingId, recordId: x.id, field: "scene_brief_items.evidence" }).join(" "),
      ]
        .filter(Boolean)
        .join(" · "),
    }));

  // 대본 표기 그대로: SCENE 12 · INT. 모텔방 – NIGHT
  const [sNum, sIntExt, sLoc, sTime] = SLUGLINE_FIELDS.map((f) => (brief(f)[0]?.value ?? "").trim());
  const slugline = [sNum, [[sIntExt, sLoc].filter(Boolean).join(" "), sTime].filter(Boolean).join(" – ")]
    .filter(Boolean)
    .join(" · ");

  const blocks = (roles: string[], target: Role) => (target === "all" ? true : roles.includes(target));

  const confirmed = b.decisions.filter((d) => d.verification_state === "approved");
  const openDecisions = b.decisions.filter((d) => d.verification_state !== "approved");

  const versions = db()
    .prepare(
      `SELECT kind, target_id, created_at FROM versions WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 12`,
    )
    .all(meetingId) as unknown as { kind: string; target_id: string | null; created_at: string }[];

  const reports = b.coverageReports;
  const pendingShots = b.shots.filter((s) => s.status !== "approved");
  const addedShots = b.shots.filter((s) => s.shot_size === "INSERT" || s.version > 1);

  // ── 공통 ─────────────────────────────────────────────────────
  const common: ReportSection[] = [
    {
      title: "Scene Brief",
      lines: (SCENE_BRIEF_FIELDS as unknown as SceneBriefField[]).flatMap(briefLine),
    },
    {
      title: "확정된 결정",
      note: confirmed.length ? undefined : "아직 사람이 승인한 결정이 없습니다. 아래는 모두 후보입니다.",
      lines: confirmed.map((d) => ({
        label: d.did,
        value: d.user_value ?? d.ai_value,
        meta: `승인 ${d.approved_by ?? ""} · ${normalizeEvidence(d.evidence, { meetingId, recordId: d.did, field: "decisions.evidence" }).join(" ")}`.trim(),
      })),
    },
    {
      title: "승인 대기 결정 후보",
      lines: openDecisions.map((d) => ({
        label: d.did,
        value: d.user_value ?? d.ai_value,
        meta: `${STATE_LABEL[d.decision_state as DecisionState] ?? d.decision_state} · ${normalizeEvidence(d.evidence, { meetingId, recordId: d.did, field: "decisions.evidence" }).join(" ")}`,
      })),
    },
    {
      title: "미결정 사항",
      lines: b.unresolved.map((u) => ({
        label: u.nid,
        value: `${u.subject} — ${u.question}`,
        meta: `막는 역할: ${parse<string[]>(u.blocks_roles, []).join(", ") || "미지정"} · ${normalizeEvidence(u.evidence, { meetingId, recordId: u.nid, field: "unresolved_items.evidence" }).join(" ")}`,
      })),
    },
    {
      title: "Scene Issues",
      lines: b.sceneIssues.map((i) => ({
        label: `${i.issue_id} ${SCENE_ISSUE_LABEL[i.type as SceneIssueType] ?? i.type}`,
        value: `${i.subject} — ${i.question}`,
        meta: `${i.status === "resolved" ? "해결됨" : "확인 필요"} · ${normalizeEvidence(i.evidence, { meetingId, recordId: i.issue_id, field: "scene_issues.evidence" }).join(" ")}`,
      })),
    },
    {
      title: "Intent Coverage",
      note: "AI 제안은 감독이 확인해야 '화면에 담김'으로 인정됩니다.",
      lines: reports.map((r) => ({
        label: `${r.intent.id} ${INTENT_LABEL[r.intent.type as IntentType]}`,
        value: r.intent.text,
        meta: `${COVERAGE_STATUS_LABEL[r.status as CoverageStatus]} · ${r.message}`,
      })),
    },
    {
      title: `Shot Board — 전체 ${b.shots.length} Shots`,
      lines: b.shots.map((s) => ({
        label: `SHOT ${String(s.shot_number).padStart(2, "0")} · ${s.shot_size}`,
        value: s.character_action,
        meta: [
          `렌즈 ${s.lens}(제안)`,
          `높이 ${s.camera_height}(제안)`,
          `움직임 ${s.camera_move}(제안)`,
          `길이 ${s.duration}`,
          `v${s.version}`,
          s.status === "approved" ? `승인 ${s.approved_by ?? ""}`.trim() : "승인 대기",
        ].join(" · "),
      })),
    },
    {
      title: "변경 이력 요약",
      lines: versions.map((v) => ({
        label: new Date(v.created_at).toLocaleString("ko-KR"),
        value: v.kind,
        meta: v.target_id ?? "",
      })),
    },
  ];

  // ── 역할별 ────────────────────────────────────────────────────
  const director: ReportSection[] = [
    {
      title: "장면 의도와 감정 변화",
      lines: (["SCENE_FUNCTION", "EMOTIONAL_ARC", "KEY_ACTION", "LAST_IMAGE"] as unknown as SceneBriefField[]).flatMap(briefLine),
    },
    {
      title: "Shot Coverage — 의도가 화면에 있는가",
      lines: reports.map((r) => ({
        label: INTENT_LABEL[r.intent.type as IntentType],
        value: r.intent.text,
        meta: `${COVERAGE_STATUS_LABEL[r.status as CoverageStatus]}${
          r.claims.length
            ? " · " +
              r.claims
                .map(
                  (c) =>
                    `쇼트 ${c.shot_number}(${coverageRoleDisplayLabel(c.role)}·${coverageStateDisplayLabel(
                      c.link.coverage_verification_state,
                    )})`,
                )
                .join(", ")
            : ""
        }`,
      })),
    },
    {
      title: "승인 대기 쇼트",
      lines: pendingShots.map((s) => ({
        label: `SHOT ${String(s.shot_number).padStart(2, "0")}`,
        value: s.character_action,
        meta: `${s.shot_size} · ${s.status}`,
      })),
    },
    {
      title: "Previs 재검토 항목",
      lines: (b.productionImpacts ?? [])
        .filter((i) => i.status !== "current")
        .map((i) => ({ label: i.target_id, value: i.label, meta: i.action })),
    },
  ];

  const writer: ReportSection[] = [
    {
      title: "인물 목표와 갈등",
      lines: (["CHARACTER_GOALS", "CONFLICT_POINT", "SCENE_FUNCTION"] as unknown as SceneBriefField[]).flatMap(briefLine),
    },
    {
      title: "행동으로 바꿀 대사",
      note: "대사 대신 화면의 행동으로 전달하기로 한 항목입니다.",
      lines: reports
        .filter((r) => r.intent.type === "key_action")
        .map((r) => ({
          label: "핵심 행동",
          value: r.intent.text,
          // 원인: r.intent.evidence 는 scene_intents.evidence — DB 에는 JSON 문자열로 저장되는데
          // 여기서는 배열로 가정하고 바로 .join 을 호출해 보고서 8경로가 전부 500 이었다.
          meta: `상태 ${COVERAGE_STATUS_LABEL[r.status as CoverageStatus]} · ${normalizeEvidence(r.intent.evidence, { meetingId, recordId: r.intent.id, field: "scene_intents.evidence" }).join(" ")}`,
        })),
    },
    {
      title: "대본 수정 사항",
      lines: b.decisions
        .filter((d) => /대사|대본|삭제|축약/.test(d.user_value ?? d.ai_value))
        .map((d) => ({
          label: d.did,
          value: d.user_value ?? d.ai_value,
          meta: `${STATE_LABEL[d.decision_state as DecisionState] ?? d.decision_state} · ${normalizeEvidence(d.evidence, { meetingId, recordId: d.did, field: "decisions.evidence" }).join(" ")}`,
        })),
    },
    {
      title: "앞뒤 장면 연속성 확인",
      lines: [
        ...b.sceneIssues
          .filter((i) => i.type === "historical_conflict")
          .map((i) => ({ label: i.issue_id, value: i.subject, meta: i.question })),
        ...b.unresolved
          .filter((u) => /연속성|씬|장면/.test(u.subject))
          .map((u) => ({ label: u.nid, value: u.subject, meta: u.question })),
      ],
    },
    {
      title: "결정되지 않은 서사 항목",
      lines: b.unresolved
        .filter((u) => blocks(parse<string[]>(u.blocks_roles, []), "writer"))
        .map((u) => ({ label: u.nid, value: u.subject, meta: u.question })),
    },
  ];

  const producer: ReportSection[] = [
    {
      title: "촬영 조건",
      lines: (["LOCATION", "TIME_OF_DAY", "TIME_CONSTRAINTS", "SAFETY_CONSTRAINTS", "BUDGET_CONSTRAINTS"] as unknown as SceneBriefField[]).flatMap(briefLine),
    },
    {
      title: "추가 쇼트",
      note: addedShots.length ? "추가 촬영이 발생합니다. 촬영 시간과 비용은 확인 후 산출하세요." : undefined,
      lines: addedShots.map((s) => ({
        label: `SHOT ${String(s.shot_number).padStart(2, "0")} · ${s.shot_size}`,
        value: s.character_action,
        meta: `v${s.version} · ${s.status}`,
      })),
    },
    {
      title: "제작 확인 사항",
      lines: [
        ...b.shots
          .filter((s) => s.production_check?.trim())
          .map((s) => ({
            label: `SHOT ${String(s.shot_number).padStart(2, "0")}`,
            value: s.production_check,
            meta: "",
          })),
        ...(b.productionImpacts ?? []).map((i) => ({
          label: i.target_id,
          value: i.label,
          meta: i.action,
        })),
      ],
    },
    {
      title: "비용·일정 산출을 막는 미결정",
      note: "이 항목들이 풀리기 전에는 금액과 촬영 일수를 산출하지 않습니다.",
      lines: b.unresolved
        .filter((u) => blocks(parse<string[]>(u.blocks_roles, []), "producer"))
        .map((u) => ({ label: u.nid, value: u.subject, meta: u.question })),
    },
  ];

  const roleSections =
    role === "director" ? director : role === "writer" ? writer : role === "producer" ? producer : [];

  // 문서 맨 앞 — 이 회의가 남긴 '해야 할 일'
  const actionItems: ReportLine[] = [
    ...reports
      .filter((r) => r.status !== "covered")
      .map((r) => ({
        label: "의도 확인",
        value: `${INTENT_LABEL[r.intent.type as IntentType]} — ${r.message}`,
      })),
    ...b.unresolved
      .filter((u) => blocks(parse<string[]>(u.blocks_roles, []), role))
      .map((u) => ({ label: "미결정", value: `${u.subject} — ${u.question}` })),
    ...b.sceneIssues
      .filter((i) => i.status !== "resolved" && blocks(parse<string[]>(i.blocks_roles, []), role))
      .map((i) => ({ label: "Scene Issue", value: `${i.issue_id} ${i.subject}` })),
  ];

  return {
    project: b.project.title,
    slugline,
    oneLine: b.project.one_line,
    date: b.meeting.extracted_at ?? "",
    participants: b.participants.map((p) => ({ name: p.name, role: p.role })),
    utteranceCount: b.utterances.length,
    role,
    common,
    roleSections,
    actionItems,
  };
}

// ── Markdown ───────────────────────────────────────────────────

const ROLE_TITLE: Record<ReportRole, string> = {
  all: "전체",
  director: "감독용",
  writer: "작가용",
  producer: "제작PD용",
  cinematographer: "촬영감독용",
  art_director: "미술감독용",
};

export function reportToMarkdown(r: MeetingReport): string {
  const out: string[] = [];
  out.push(`# ${r.project} — ${r.slugline}`);
  out.push("");
  out.push(`**${ROLE_TITLE[r.role]} 회의 결과 문서**`);
  out.push("");
  if (r.oneLine) out.push(`> ${r.oneLine}`);
  out.push("");
  out.push(`| 항목 | 내용 |`);
  out.push(`|---|---|`);
  out.push(`| 회의 일시 | ${r.date ? new Date(r.date).toLocaleString("ko-KR") : "미기록"} |`);
  out.push(
    `| 참여자 | ${r.participants.map((p) => `${p.name}${p.role ? `(${p.role})` : ""}`).join(", ")} |`,
  );
  out.push(`| 발언 수 | ${r.utteranceCount} |`);
  out.push("");

  if (r.actionItems.length) {
    out.push(`## 회의 후 확인할 것`);
    out.push("");
    for (const a of r.actionItems) out.push(`- **${a.label}** ${a.value}`);
    out.push("");
  }

  const section = (s: ReportSection) => {
    out.push(`## ${s.title}`);
    out.push("");
    if (s.note) {
      out.push(`> ${s.note}`);
      out.push("");
    }
    if (!s.lines.length) {
      out.push(`_해당 항목 없음_`);
      out.push("");
      return;
    }
    for (const l of s.lines) {
      out.push(`- **${l.label}** — ${l.value}`);
      if (l.meta) out.push(`  - ${l.meta}`);
    }
    out.push("");
  };

  for (const s of r.roleSections) section(s);
  if (r.roleSections.length) {
    out.push("---");
    out.push("");
  }
  for (const s of r.common) section(s);

  out.push("---");
  out.push("");
  out.push(
    "_이 문서는 회의 발언에서 추출한 내용과 사람이 승인한 값만 담습니다. 촬영 시간·비용은 확인 전까지 산출하지 않습니다._",
  );
  return out.join("\n");
}
