import { isPracticeMeeting } from "../meetingIntake/store";
/**
 * 사람의 결정: 관점 비교에서 고른 값(초안) → 합의 화면에서 승인(해결) → 결정 원장.
 *
 * AI 는 이 파일의 함수를 부르지 않는다. 승인자 이름 없이 resolved 가 되지 않는다.
 */
import { z } from "zod";
import { db, now, uid } from "../db";
import { SLOT_KEYS, type AlignmentIssueV2 } from "./schema";
import { getIssue, setIssueState } from "./store";

export const SelectedValue = z.object({
  slot: z.enum(SLOT_KEYS),
  value: z.string().min(1),
  /** 누구의 값을 골랐는가. 직접 입력이면 null */
  speakerKey: z.string().nullable(),
  evidence: z.array(z.string()),
  source: z.enum(["selected", "typed"]),
});
export type SelectedValue = z.infer<typeof SelectedValue>;

export function getDraft(runId: string, issueId: string): SelectedValue[] {
  const r = db().prepare(`SELECT selected_json FROM alignment_v2_drafts WHERE run_id = ? AND issue_id = ?`).get(runId, issueId) as
    | { selected_json: string }
    | undefined;
  return r ? (JSON.parse(r.selected_json) as SelectedValue[]) : [];
}

export function saveDraft(meetingId: string, runId: string, issueId: string, selected: SelectedValue[], by: string | null): void {
  const parsed = z.array(SelectedValue).parse(selected);
  db()
    .prepare(
      `INSERT INTO alignment_v2_drafts (run_id, issue_id, meeting_id, selected_json, updated_by, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(run_id, issue_id) DO UPDATE SET selected_json = excluded.selected_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .run(runId, issueId, meetingId, JSON.stringify(parsed), by, now());
}

export type ResolutionRow = {
  run_id: string;
  issue_id: string;
  meeting_id: string;
  selected_json: string;
  answers_json: string;
  summary: string;
  resolved_by: string;
  resolved_at: string;
};

export function getResolution(runId: string, issueId: string): (ResolutionRow & { selected: SelectedValue[] }) | null {
  const r = db().prepare(`SELECT * FROM alignment_v2_resolutions WHERE run_id = ? AND issue_id = ?`).get(runId, issueId) as
    | ResolutionRow
    | undefined;
  return r ? { ...r, selected: JSON.parse(r.selected_json) as SelectedValue[] } : null;
}

/** 이 안건에서 사람이 값을 정해야 하는 항목: 입장들이 값을 말한 항목 전체. */
export function slotsToDecide(issue: AlignmentIssueV2): string[] {
  const s = new Set<string>();
  for (const p of issue.positions) for (const k of Object.keys(p.slots)) s.add(k);
  return SLOT_KEYS.filter((k) => s.has(k));
}

export class ResolutionError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "MISSING_APPROVER" | "INCOMPLETE" | "ALREADY_RESOLVED",
    message: string,
  ) {
    super(message);
    this.name = "ResolutionError";
  }
}

/**
 * 합의 승인. 정할 항목이 모두 채워져야 하고(비워 두려면 명시적으로 "정하지 않음"을 적는다),
 * 승인자 이름이 있어야 한다. 승인되면 안건은 resolved 가 되고 항목 값이 결정 원장에 들어간다.
 */
export function resolveIssue(opts: {
  meetingId: string;
  runId: string;
  issueId: string;
  selected: SelectedValue[];
  summary: string;
  resolvedBy: string;
  projectId: string;
}): { ledgerIds: string[] } {
  if (isPracticeMeeting(opts.meetingId)) throw new ResolutionError("INCOMPLETE", "가상·예정 자료는 실제 결정으로 승인할 수 없습니다.");
  const issue = getIssue(opts.meetingId, opts.issueId, opts.runId);
  if (!issue) throw new ResolutionError("NOT_FOUND", "안건을 찾을 수 없습니다.");
  if (!opts.resolvedBy.trim()) throw new ResolutionError("MISSING_APPROVER", "승인한 사람 이름이 필요합니다.");
  if (issue.state === "resolved") throw new ResolutionError("ALREADY_RESOLVED", "이미 승인된 안건입니다.");
  const selected = z.array(SelectedValue).parse(opts.selected);
  const need = slotsToDecide(issue);
  const have = new Set(selected.map((s) => s.slot));
  const missing = need.filter((k) => !have.has(k as (typeof SLOT_KEYS)[number]));
  if (missing.length > 0 && selected.length === 0) {
    throw new ResolutionError("INCOMPLETE", `정하지 않은 항목이 있습니다: ${missing.join(", ")}`);
  }

  const d = db();
  const ts = now();
  const ledgerIds: string[] = [];
  d.exec("BEGIN IMMEDIATE");
  try {
    d.prepare(
      `INSERT INTO alignment_v2_resolutions (run_id, issue_id, meeting_id, selected_json, answers_json, summary, resolved_by, resolved_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(opts.runId, opts.issueId, opts.meetingId, JSON.stringify(selected), JSON.stringify({ missing }), opts.summary.trim(), opts.resolvedBy.trim(), ts);
    const ins = d.prepare(
      `INSERT INTO decision_ledger (id, project_id, meeting_id, run_id, issue_id, decision, slot, value, evidence, decided_by, decided_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const sup = d.prepare(`UPDATE decision_ledger SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL`);
    for (const s of selected) {
      const id = `L-${uid()}`;
      ins.run(id, opts.projectId, opts.meetingId, opts.runId, opts.issueId, issue.decision, s.slot, s.value, JSON.stringify(s.evidence), opts.resolvedBy.trim(), ts);
      ledgerIds.push(id);
      // 과거 결정 충돌을 사람이 정리했으면, 같은 항목의 옛 결정은 이 결정으로 대체된다(값이 같아도 최신 승인이 기준).
      for (const p of issue.past_decisions) if (p.slot === s.slot) sup.run(id, p.ledger_id);
    }
    d.exec("COMMIT");
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    throw e;
  }
  setIssueState(opts.runId, opts.issueId, "resolved", opts.resolvedBy.trim());
  return { ledgerIds };
}

/** 현재 run 에서 사람이 이미 손댄 안건 수. 재분석 전에 경고하는 데 쓴다. */
export function humanTouchedCount(runId: string): number {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM alignment_v2_issues WHERE run_id = ? AND (state IN ('resolved','dismissed') OR approved_by IS NOT NULL)`,
    )
    .get(runId) as { n: number };
  const d = db().prepare(`SELECT COUNT(*) AS n FROM alignment_v2_drafts WHERE run_id = ?`).get(runId) as { n: number };
  return r.n + d.n;
}
