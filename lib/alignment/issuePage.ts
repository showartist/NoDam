/**
 * 관점 비교·합의 화면의 서버 데이터: 안건 하나 + 초안 + 승인 기록 + 생성 이미지.
 */
import { db } from "../db";
import { loadAlignmentPageData, type AlignmentPageData } from "./pageData";
import { getDraft, getResolution, type SelectedValue } from "./resolution";
import type { AlignmentIssueV2 } from "./schema";

export type ImageRow = {
  id: string;
  kind: string;
  speaker_key: string | null;
  status: string;
  model: string;
  resolution: string;
  error: string | null;
  created_at: string;
  similarity_json: string | null;
};

export type ShotLite = { id: string; shot_number: number; shot_size: string; purpose: string; image_state: string; image_url: string | null; status: string };

export type IssuePageData = AlignmentPageData & {
  runId: string;
  issue: AlignmentIssueV2;
  draft: SelectedValue[];
  resolution: { selected: SelectedValue[]; summary: string; resolved_by: string; resolved_at: string } | null;
  images: ImageRow[];
  shots: ShotLite[];
};

export function loadIssuePageData(meetingId: string, issueId: string): IssuePageData | "no_meeting" | "no_issue" {
  const base = loadAlignmentPageData(meetingId);
  if (!base) return "no_meeting";
  const issue = base.issues.find((i) => i.issue_id === issueId);
  if (!issue || !base.run) return "no_issue";
  const images = db()
    .prepare(
      `SELECT id, kind, speaker_key, status, model, resolution, error, created_at, similarity_json
         FROM generated_images WHERE meeting_id = ? AND issue_id = ? AND (run_id = ? OR run_id IS NULL)
        ORDER BY created_at DESC`,
    )
    .all(meetingId, issueId, base.run.id)
    // node:sqlite 행은 프로토타입이 null 이라 클라이언트 컴포넌트로 넘길 수 없다. 평범한 객체로 옮긴다.
    .map((r) => ({ ...r })) as unknown as ImageRow[];
  const res = getResolution(base.run.id, issueId);
  const shots = db()
    .prepare(`SELECT id, shot_number, shot_size, purpose, image_state, image_url, status FROM shots WHERE meeting_id = ? ORDER BY shot_number`)
    .all(meetingId)
    .map((r) => ({ ...r })) as unknown as ShotLite[];
  return {
    shots,
    ...base,
    runId: base.run.id,
    issue,
    draft: getDraft(base.run.id, issueId),
    resolution: res ? { selected: res.selected, summary: res.summary, resolved_by: res.resolved_by, resolved_at: res.resolved_at } : null,
    images,
  };
}
