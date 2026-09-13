/**
 * 해석 차이 탐지 v2 저장소.
 *
 * run 하나가 끝나면 그 회의의 "현재 안건 묶음"이 된다. 이전 run 의 안건은 지우지 않는다.
 * 사람이 한 결정(해결·승인)은 run_id + issue_id 로 묶어 따로 둔다.
 */
import { db, now, uid } from "../db";
import { AlignmentIssueV2, type AgreementV2, type IssueStateV2 } from "./schema";

export type MeetingUtterance = {
  uid: string;
  idx: number;
  /** 내부 화자 키. diarization id 가 있으면 그 값, 없으면 이름 기반 키(N:이름) */
  speakerKey: string | null;
  speakerId: string | null;
  speakerName: string | null;
  role: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
};

type UtteranceDbRow = {
  uid: string;
  idx: number;
  speaker_id: string | null;
  speaker_name: string | null;
  mapped_name: string | null;
  mapped_role: string | null;
  role: string | null;
  text_clean: string;
  start_ms: number | null;
  end_ms: number | null;
};

export function speakerKeyOf(speakerId: string | null, speakerName: string | null): string | null {
  if (speakerId) return speakerId;
  if (speakerName && speakerName.trim()) return `N:${speakerName.trim()}`;
  return null;
}

/** 회의 발언. 화자 이름·역할은 사람이 붙인 매핑이 있으면 그 값을 먼저 쓴다. */
export function getMeetingUtterances(meetingId: string): MeetingUtterance[] {
  const rows = db()
    .prepare(
      `SELECT u.uid, u.idx, u.speaker_id, u.speaker_name, u.role, u.text_clean, u.start_ms, u.end_ms,
              m.display_name AS mapped_name, m.role AS mapped_role
         FROM utterances u
         LEFT JOIN speaker_mappings m ON m.meeting_id = u.meeting_id AND m.speaker_id = u.speaker_id
        WHERE u.meeting_id = ?
        ORDER BY u.idx`,
    )
    .all(meetingId) as unknown as UtteranceDbRow[];
  return rows.map((r) => {
    const name = r.mapped_name ?? r.speaker_name ?? null;
    return {
      uid: r.uid,
      idx: r.idx,
      speakerKey: speakerKeyOf(r.speaker_id, r.speaker_name),
      speakerId: r.speaker_id,
      speakerName: name,
      role: r.mapped_role ?? r.role ?? null,
      text: r.text_clean,
      startMs: r.start_ms ?? null,
      endMs: r.end_ms ?? null,
    };
  });
}

export type RunMode = "batch" | "window" | "live";

export type RunRow = {
  id: string;
  meeting_id: string;
  mode: RunMode;
  model: string;
  judge_model: string | null;
  status: "running" | "completed" | "failed";
  error: string | null;
  data_mode: "live" | "fixture";
  utterance_count: number | null;
  window_count: number | null;
  latency_ms: number | null;
  usage_json: string | null;
  stats_json: string | null;
  agreements_json: string | null;
  created_at: string;
  finished_at: string | null;
};

export function createRun(
  meetingId: string,
  mode: RunMode,
  model: string,
  opts: { judgeModel?: string | null; dataMode?: "live" | "fixture"; utteranceCount?: number } = {},
): string {
  const id = `run_${uid()}`;
  db()
    .prepare(
      `INSERT INTO alignment_v2_runs (id, meeting_id, mode, model, judge_model, status, data_mode, utterance_count, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, meetingId, mode, model, opts.judgeModel ?? null, "running", opts.dataMode ?? "live", opts.utteranceCount ?? null, now());
  return id;
}

export function finishRun(
  runId: string,
  r: {
    status: "completed" | "failed";
    error?: string | null;
    latencyMs?: number;
    windowCount?: number;
    usage?: unknown;
    stats?: unknown;
    agreements?: AgreementV2[];
  },
): void {
  db()
    .prepare(
      `UPDATE alignment_v2_runs
          SET status = ?, error = ?, latency_ms = ?, window_count = ?, usage_json = ?, stats_json = ?,
              agreements_json = ?, finished_at = ?
        WHERE id = ?`,
    )
    .run(
      r.status,
      r.error ?? null,
      r.latencyMs ?? null,
      r.windowCount ?? null,
      r.usage === undefined ? null : JSON.stringify(r.usage),
      r.stats === undefined ? null : JSON.stringify(r.stats),
      r.agreements === undefined ? null : JSON.stringify(r.agreements),
      now(),
      runId,
    );
}

export function getRun(runId: string): RunRow | null {
  return (db().prepare(`SELECT * FROM alignment_v2_runs WHERE id = ?`).get(runId) as unknown as RunRow) ?? null;
}

/** 화면이 읽는 "현재" run. 끝난 run 중 가장 최근 것. live 모드는 진행 중인 run 도 현재로 본다. */
export function getCurrentRun(meetingId: string, opts: { includeRunning?: boolean } = {}): RunRow | null {
  const statuses = opts.includeRunning ? `('completed','running')` : `('completed')`;
  const row = db()
    .prepare(
      `SELECT * FROM alignment_v2_runs WHERE meeting_id = ? AND status IN ${statuses}
        AND created_at >= COALESCE((SELECT MAX(created_at) FROM transcription_runs WHERE meeting_id = alignment_v2_runs.meeting_id), '')
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(meetingId) as unknown as RunRow | undefined;
  return row ?? null;
}

export function listRuns(meetingId: string): RunRow[] {
  return db()
    .prepare(`SELECT * FROM alignment_v2_runs WHERE meeting_id = ? ORDER BY created_at DESC`)
    .all(meetingId) as unknown as RunRow[];
}

/** 안건 저장. 같은 run 안에서 같은 issue_id 면 덮어쓴다(창 단위 갱신). 저장 전에 스키마로 검증한다. */
export function upsertIssue(runId: string, issue: AlignmentIssueV2): void {
  const parsed = AlignmentIssueV2.parse(issue);
  db()
    .prepare(
      `INSERT INTO alignment_v2_issues (run_id, issue_id, meeting_id, key, type, state, severity, body, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(run_id, issue_id) DO UPDATE SET
         key = excluded.key, type = excluded.type, state = excluded.state, severity = excluded.severity,
         body = excluded.body, updated_at = excluded.updated_at`,
    )
    .run(
      runId,
      parsed.issue_id,
      parsed.meeting_id,
      parsed.key,
      parsed.type,
      parsed.state,
      parsed.severity,
      JSON.stringify(parsed),
      parsed.created_at,
      parsed.updated_at,
    );
}

export function saveIssues(runId: string, issues: AlignmentIssueV2[]): void {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    for (const i of issues) upsertIssue(runId, i);
    d.exec("COMMIT");
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    throw e;
  }
}

type IssueDbRow = { body: string; state: string; approved_by: string | null; approved_at: string | null };

function rowToIssue(r: IssueDbRow): AlignmentIssueV2 {
  const body = JSON.parse(r.body) as AlignmentIssueV2;
  // 사람이 바꾼 상태가 body 보다 우선한다.
  return { ...body, state: r.state as IssueStateV2 };
}

export function listIssues(meetingId: string, runId?: string | null): AlignmentIssueV2[] {
  const rid = runId ?? getCurrentRun(meetingId, { includeRunning: true })?.id;
  if (!rid) return [];
  const rows = db()
    .prepare(`SELECT body, state, approved_by, approved_at FROM alignment_v2_issues WHERE run_id = ? ORDER BY issue_id`)
    .all(rid) as unknown as IssueDbRow[];
  return rows.map(rowToIssue);
}

export function getIssue(meetingId: string, issueId: string, runId?: string | null): AlignmentIssueV2 | null {
  const rid = runId ?? getCurrentRun(meetingId, { includeRunning: true })?.id;
  if (!rid) return null;
  const row = db()
    .prepare(`SELECT body, state, approved_by, approved_at FROM alignment_v2_issues WHERE run_id = ? AND issue_id = ?`)
    .get(rid, issueId) as unknown as IssueDbRow | undefined;
  return row ? rowToIssue(row) : null;
}

/** 사람의 상태 변경. resolved 는 approvedBy 가 있어야 한다. */
export function setIssueState(runId: string, issueId: string, state: IssueStateV2, approvedBy: string | null): void {
  if (state === "resolved" && !approvedBy) {
    throw new Error("resolved 는 승인한 사람이 있어야 합니다.");
  }
  db()
    .prepare(
      `UPDATE alignment_v2_issues SET state = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE run_id = ? AND issue_id = ?`,
    )
    .run(state, approvedBy, approvedBy ? now() : null, now(), runId, issueId);
}

export function getAgreements(meetingId: string, runId?: string | null): AgreementV2[] {
  const run = runId ? getRun(runId) : getCurrentRun(meetingId, { includeRunning: true });
  if (!run?.agreements_json) return [];
  return JSON.parse(run.agreements_json) as AgreementV2[];
}
