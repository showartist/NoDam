/**
 * v2 화면(다시 짚기·관점 비교·합의)이 서버에서 읽는 데이터 묶음.
 */
import { db } from "../db";
import { ensureScene12Seed, ensureSeed, DEMO_MEETING_ID, SCENE12_MEETING_ID } from "../seed";
import { parseSceneLine, speakerDisplay } from "./present";
import { getAgreements, getCurrentRun, getMeetingUtterances, listIssues, listRuns, type RunRow } from "./store";
import type { AgreementV2, AlignmentIssueV2 } from "./schema";

export type UttLite = { uid: string; who: string; text: string };

export type RunSummary = {
  id: string;
  status: string;
  mode: string;
  model: string;
  judge_model: string | null;
  latency_ms: number | null;
  created_at: string;
  error: string | null;
  costUsd: number | null;
  utterance_count: number | null;
};

export function toRunSummary(r: RunRow): RunSummary {
  const usage = r.usage_json ? (JSON.parse(r.usage_json) as { costUsd?: number | null }) : null;
  return {
    id: r.id,
    status: r.status,
    mode: r.mode,
    model: r.model,
    judge_model: r.judge_model,
    latency_ms: r.latency_ms,
    created_at: r.created_at,
    error: r.error,
    costUsd: usage?.costUsd ?? null,
    utterance_count: r.utterance_count,
  };
}

export type AlignmentPageData = {
  meetingId: string;
  projectId: string;
  projectTitle: string;
  scene: { sceneNumber: number | null; slugline: string | null; oneLiner: string | null };
  run: RunSummary | null;
  lastFailed: RunSummary | null;
  issues: AlignmentIssueV2[];
  agreements: AgreementV2[];
  utts: Record<string, UttLite>;
  utteranceCount: number;
};

/** 데모 회의는 첫 접속 때 시드한다(회의 기록 화면과 같은 규칙). 없는 회의면 null. */
export function loadAlignmentPageData(meetingId: string): AlignmentPageData | null {
  if (meetingId === DEMO_MEETING_ID) ensureSeed(meetingId);
  if (meetingId === SCENE12_MEETING_ID) ensureScene12Seed(meetingId);
  const m = db()
    .prepare(`SELECT m.id, m.project_id, p.title, p.one_line FROM meetings m JOIN projects p ON p.id = m.project_id WHERE m.id = ?`)
    .get(meetingId) as { id: string; project_id: string; title: string; one_line: string | null } | undefined;
  if (!m) return null;

  const run = getCurrentRun(meetingId, { includeRunning: true });
  const failed = listRuns(meetingId).find((r) => r.status === "failed") ?? null;
  const utterances = getMeetingUtterances(meetingId);
  const utts: Record<string, UttLite> = {};
  for (const u of utterances) {
    utts[u.uid] = { uid: u.uid, who: speakerDisplay({ name: u.speakerName, role: u.role, key: u.speakerKey }), text: u.text };
  }
  return {
    meetingId,
    projectId: m.project_id,
    projectTitle: m.title,
    scene: parseSceneLine(m.one_line),
    run: run ? toRunSummary(run) : null,
    lastFailed: failed && (!run || failed.created_at > run.created_at) ? toRunSummary(failed) : null,
    issues: run ? listIssues(meetingId, run.id) : [],
    agreements: run ? getAgreements(meetingId, run.id) : [],
    utts,
    utteranceCount: utterances.length,
  };
}
