/**
 * 화면 표시용 순수 함수. 서버·클라이언트 양쪽에서 쓴다(DB·fs 를 import 하지 않는다).
 */
import {
  ISSUE_STATE_LABEL,
  ISSUE_TYPE_LABEL,
  SEVERITIES,
  SLOT_LABEL,
  type AlignmentIssueV2,
  type IssueStateV2,
  type PositionV2,
  type SeverityV2,
  type SlotKey,
} from "./schema";

export { ISSUE_STATE_LABEL, ISSUE_TYPE_LABEL, SLOT_LABEL };

export const SEVERITY_LABEL: Record<SeverityV2, string> = {
  critical: "제작 차단",
  high: "결과물이 달라짐",
  medium: "확인 필요",
  low: "표현 차이",
};

export const CONTEXT_LABEL: Record<PositionV2["checks"]["context"], string> = {
  supported: "근거 충분",
  partial: "추가 확인 필요",
  contradicted: "근거와 어긋남",
  not_checked: "문맥 검사 안 함",
};

export function severityRank(s: SeverityV2): number {
  return SEVERITIES.indexOf(s);
}

/** 열린 안건 먼저, 그 안에서 심각도 순, 같으면 번호 순. */
export function sortIssues(issues: AlignmentIssueV2[]): AlignmentIssueV2[] {
  const closed = (s: IssueStateV2) => (s === "resolved" || s === "dismissed" ? 1 : 0);
  return [...issues].sort(
    (a, b) => closed(a.state) - closed(b.state) || severityRank(a.severity) - severityRank(b.severity) || a.issue_id.localeCompare(b.issue_id),
  );
}

export function speakerDisplay(p: { name: string | null; role: string | null; key: string | null }): string {
  if (p.name && p.role) return `${p.name} (${p.role})`;
  return p.name ?? p.role ?? p.key ?? "화자 미상";
}

/** 작품 한 줄 설명 "SCENE 34. INT. 실내 수영장 – NIGHT — 폐장 후 …" 을 나눈다. 형식이 다르면 전부 null. */
export function parseSceneLine(oneLine: string | null | undefined): { sceneNumber: number | null; slugline: string | null; oneLiner: string | null } {
  if (!oneLine) return { sceneNumber: null, slugline: null, oneLiner: null };
  const m = oneLine.match(/^\s*SCENE\s*(\d+)\.?\s*(.*?)(?:\s+—\s+(.*))?$/);
  if (!m) return { sceneNumber: null, slugline: null, oneLiner: oneLine };
  return { sceneNumber: Number(m[1]), slugline: m[2]?.trim() || null, oneLiner: m[3]?.trim() || null };
}

/** slots: 이 줄이 묶은 항목들. 조명·색처럼 두 항목을 한 줄로 비교했으면 둘, 아니면 slot 하나. */
export type SlotRow = { slot: SlotKey; slots: SlotKey[]; label: string; values: { speakerKey: string; value: string }[]; state: "same" | "differs" | "single" };

/** 지난 회의 결정 열의 key 접두어. 고른 값의 speakerKey 에도 이 key 가 들어간다. */
export const LEDGER_KEY_PREFIX = "LEDGER:";
export const isLedgerKey = (key: string | null | undefined) => !!key && key.startsWith(LEDGER_KEY_PREFIX);

export type CompareColumn = { key: string; label: string; slots: Partial<Record<SlotKey, string>>; evidence: string[]; past: boolean };

/**
 * 항목 비교 표의 열: 이번 회의 입장마다 한 열, 과거 결정 충돌이면 지난 회의에서 승인된 값 한 열.
 * 지난 결정의 근거 발언은 다른 회의 것이라 이 회의의 근거 칩으로 잇지 않는다(evidence 비움).
 */
export function compareColumns(issue: AlignmentIssueV2): CompareColumn[] {
  const cols: CompareColumn[] = issue.positions.map((p) => ({
    key: p.speaker.key ?? "?",
    label: speakerDisplay(p.speaker),
    slots: p.slots,
    evidence: p.evidence,
    past: false,
  }));
  for (const d of issue.past_decisions) {
    cols.push({ key: `${LEDGER_KEY_PREFIX}${d.ledger_id}`, label: "지난 회의 결정", slots: { [d.slot]: d.value }, evidence: [], past: true });
  }
  return cols;
}

/** 관점 비교 표의 행: 입장들(과 지난 결정)이 말한 항목마다 열별 값. */
export function slotRows(issue: AlignmentIssueV2): SlotRow[] {
  const diff = new Map(issue.slot_diff.map((d) => [d.slot, d]));
  // 두 항목을 한 줄로 비교한 짝(distance.ts RELATED_SLOTS)은 대표 항목 줄 하나로 보여 준다.
  const merged = new Set<SlotKey>(issue.slot_diff.flatMap((d) => d.slots ?? []));
  const rows: SlotRow[] = [];
  const order = Object.keys(SLOT_LABEL) as SlotKey[];
  const cols = compareColumns(issue);
  for (const slot of order) {
    const d = diff.get(slot);
    const slots: SlotKey[] = d?.slots ?? [slot];
    if (!d?.slots && merged.has(slot)) continue;
    const values = cols
      .map((c) => ({ speakerKey: c.key, value: slots.map((k) => c.slots[k]).find(Boolean) }))
      .filter((v): v is { speakerKey: string; value: string } => !!v.value);
    if (values.length === 0) continue;
    rows.push({
      slot,
      slots,
      label: slots.map((k) => SLOT_LABEL[k]).join("·"),
      values,
      state: values.length < 2 ? "single" : (d?.state ?? "differs"),
    });
  }
  return rows;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}

export function formatUsd(v: number | null | undefined): string {
  if (v == null) return "보고값 없음";
  return `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
}
