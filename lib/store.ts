import { db, now, recordVersion, uid } from "./db";
import { parseTranscript } from "./parse";
import {
  buildIntentCoverageViewModel,
  bumpIntent,
  evaluateCoverage,
  getCoverageLinks,
  getIntents,
} from "./intents";
import type { Extracted, ImageState, ReferenceApplication, ShotStatus } from "./types";

export type ProjectRow = { id: string; title: string; domain: string; one_line: string | null };

export type UtteranceRow = {
  id: string;
  uid: string;
  speaker_id: string | null;
  speaker_name: string;
  role: string | null;
  ts_start: string | null;
  ts_end: string | null;
  text_raw: string;
  text_clean: string;
  stage_direction: string | null;
};

export type BriefItemRow = {
  id: string;
  field: string;
  ai_value: string;
  user_value: string | null;
  decision_state: string;
  verification_state: string;
  approved_by: string | null;
  approved_at: string | null;
  evidence: string;
  confidence: string;
  note: string | null;
};
export type CoreItemRow = BriefItemRow;

export type UnresolvedRow = {
  id: string;
  nid: string;
  subject: string;
  evidence: string;
  question: string;
  blocks_roles: string;
};

export type ShotRow = {
  id: string;
  meeting_id: string;
  shot_number: number;
  shot_size: string;
  image_url: string | null;
  lens: string;
  camera_height: string;
  camera_move: string;
  character_action: string;
  dialogue_sound: string;
  duration: string;
  purpose: string;
  production_check: string;
  evidence: string;
  covers: string;
  is_representative: number;
  /** 이미지 생성 여부. 'generated' 가 아니면 최종 승인(approve)으로 갈 수 없다. */
  image_state: ImageState;
  status: ShotStatus;
  version: number;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
};

export type ReferenceRow = {
  id: string;
  meeting_id: string;
  kind: string;
  source: string;
  description: string;
  application: ReferenceApplication;
  evidence: string;
  updated_at: string;
};

export type SceneIssueRow = {
  issue_id: string;
  meeting_id: string;
  type: string;
  subject: string;
  question: string;
  positions: string;
  evidence: string;
  severity: string;
  status: string;
  blocks_roles: string;
};

export type AlignmentResolutionRow = {
  issue_id: string;
  meeting_id: string;
  question: string;
  selected_option: string;
  resolved_text: string;
  evidence: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type AssetImpactRow = {
  id: string;
  meeting_id: string;
  issue_id: string;
  asset_type: string;
  target_id: string;
  label: string;
  status: "stale" | "current" | "regenerating";
  action: string;
  updated_at: string;
};

export type AlignmentScoreSnapshotRow = {
  id: string;
  meeting_id: string;
  issue_id: string | null;
  alignment_risk: number;
  flow_risk: number;
  score: number;
  note: string;
  created_at: string;
};

// node:sqlite 는 null-prototype 객체를 돌려준다. 서버 컴포넌트에서 클라이언트로
// 넘기려면 평범한 객체여야 하므로 여기서 한 번 벗겨낸다.
const plain = <T,>(rows: unknown[]) => rows.map((r) => ({ ...(r as object) })) as T[];
const plainOne = <T,>(row: unknown) => (row ? ({ ...(row as object) } as T) : undefined);

export function createProject(input: {
  title: string;
  domain: string;
  oneLine: string;
  participants: { name: string; role: string }[];
  transcript: string;
  meetingId?: string;
}) {
  const d = db();
  const projectId = uid();
  const meetingId = input.meetingId ?? uid();
  const ts = now();

  d.prepare(
    `INSERT INTO projects (id, title, domain, one_line, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(projectId, input.title, input.domain, input.oneLine || null, ts);

  const byName = new Map<string, string>();
  for (const p of input.participants) {
    if (!p.name.trim()) continue;
    const id = uid();
    byName.set(p.name.trim(), id);
    d.prepare(`INSERT INTO participants (id, project_id, name, role) VALUES (?, ?, ?, ?)`).run(
      id,
      projectId,
      p.name.trim(),
      p.role.trim() || null,
    );
  }

  d.prepare(
    `INSERT INTO meetings (id, project_id, title, raw_transcript, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(meetingId, projectId, null, input.transcript, ts);

  const parsed = parseTranscript(input.transcript);
  const ins = d.prepare(
    `INSERT INTO utterances
       (id, meeting_id, idx, uid, speaker_id, speaker_name, role, ts_start, ts_end,
        text_raw, text_clean, stage_direction)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  parsed.forEach((u, i) => {
    ins.run(
      uid(),
      meetingId,
      i,
      u.uid,
      byName.get(u.speakerName) ?? null,
      u.speakerName,
      u.role ?? null,
      u.tsStart,
      u.tsEnd,
      u.textRaw,
      u.textClean,
      u.stageDirection,
    );
  });

  return { projectId, meetingId, utteranceCount: parsed.length };
}

export function getBundle(meetingId: string) {
  const d = db();
  const meeting = plainOne<{ id: string; project_id: string; extracted_at: string | null }>(
    d.prepare(`SELECT * FROM meetings WHERE id = ?`).get(meetingId),
  );
  if (!meeting) return null;

  const project = plainOne<ProjectRow>(
    d.prepare(`SELECT id, title, domain, one_line FROM projects WHERE id = ?`).get(meeting.project_id),
  )!;

  const briefItems = plain<BriefItemRow>(
    d.prepare(`SELECT * FROM scene_brief_items WHERE meeting_id = ? ORDER BY idx`).all(meetingId),
  );
  const shots = plain<ShotRow>(
    d.prepare(`SELECT * FROM shots WHERE meeting_id = ? ORDER BY shot_number`).all(meetingId),
  );
  const intents = getIntents(meetingId);
  const coverageLinks = getCoverageLinks(meetingId);
  const coverageReports = evaluateCoverage(intents, coverageLinks, shots);

  return {
    meeting,
    project,
    participants: plain<{ id: string; name: string; role: string | null }>(
      d.prepare(`SELECT id, name, role FROM participants WHERE project_id = ?`).all(meeting.project_id),
    ),
    utterances: plain<UtteranceRow>(
      d.prepare(`SELECT * FROM utterances WHERE meeting_id = ? ORDER BY idx`).all(meetingId),
    ),
    briefItems,
    decisions: plain<BriefItemRow & { did: string }>(
      d.prepare(`SELECT * FROM decisions WHERE meeting_id = ? ORDER BY did`).all(meetingId),
    ),
    unresolved: plain<UnresolvedRow>(
      d.prepare(`SELECT * FROM unresolved_items WHERE meeting_id = ? ORDER BY nid`).all(meetingId),
    ),
    shots,
    references: plain<ReferenceRow>(
      d.prepare(`SELECT * FROM visual_references WHERE meeting_id = ? ORDER BY kind`).all(meetingId),
    ),
    sceneIssues: plain<SceneIssueRow>(
      d.prepare(`SELECT * FROM scene_issues WHERE meeting_id = ? ORDER BY issue_id`).all(meetingId),
    ),
    alignmentResolution: getAlignmentResolution(meetingId, "A-01"),
    alignmentScoreSnapshot: getAlignmentScoreSnapshot(meetingId),
    // Film Intent Coverage — 의도가 화면에 실제로 담겼는지
    intents,
    coverageLinks,
    coverageReports,
    coverageGaps: coverageReports.filter((r) => r.status !== "covered"),
    /** page.tsx 는 이 뷰모델 하나만 Workbench 로 넘긴다. */
    intentCoverage: buildIntentCoverageViewModel(meetingId, shots),
    productionImpacts: plain<AssetImpactRow>(
      d
        .prepare(
          `SELECT * FROM asset_impacts WHERE meeting_id = ? AND asset_type = 'production' ORDER BY updated_at DESC`,
        )
        .all(meetingId),
    ),
  };
}

/** 추출 결과 저장. 재추출 시 기존 행은 버전으로 남긴다. */
export function saveExtraction(meetingId: string, value: Extracted) {
  const d = db();
  const prior = getBundle(meetingId);
  if (prior && prior.briefItems.length) {
    recordVersion(meetingId, "extraction.replaced", null, {
      briefItems: prior.briefItems,
      decisions: prior.decisions,
    });
  }

  d.prepare(`DELETE FROM scene_brief_items WHERE meeting_id = ?`).run(meetingId);
  d.prepare(`DELETE FROM decisions WHERE meeting_id = ?`).run(meetingId);
  d.prepare(`DELETE FROM unresolved_items WHERE meeting_id = ?`).run(meetingId);

  const insBrief = d.prepare(
    `INSERT INTO scene_brief_items
       (id, meeting_id, field, idx, ai_value, decision_state, evidence, confidence, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let i = 0;
  for (const [field, items] of Object.entries(value.scene_brief)) {
    for (const it of items) {
      insBrief.run(
        uid(),
        meetingId,
        field,
        i++,
        it.content,
        it.decision_state,
        JSON.stringify(it.evidence),
        it.confidence,
        it.note ?? null,
      );
    }
  }

  const insDec = d.prepare(
    `INSERT INTO decisions
       (id, meeting_id, did, ai_value, decision_state, evidence, confidence, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const dec of value.decisions) {
    insDec.run(
      uid(),
      meetingId,
      dec.id,
      dec.content,
      dec.decision_state,
      JSON.stringify(dec.evidence),
      dec.confidence,
      dec.note ?? null,
    );
  }

  const insUn = d.prepare(
    `INSERT INTO unresolved_items (id, meeting_id, nid, subject, evidence, question, blocks_roles)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const u of value.unresolved) {
    insUn.run(
      uid(),
      meetingId,
      u.id,
      u.subject,
      JSON.stringify(u.evidence),
      u.question,
      JSON.stringify(u.blocks_roles ?? []),
    );
  }

  // 의도 — Intent Coverage 검사의 출발점. 재추출 시 기존 의도는 버전으로 남기고 새로 쓴다.
  const priorIntents = d
    .prepare(`SELECT * FROM scene_intents WHERE meeting_id = ?`)
    .all(meetingId) as unknown[];
  if (priorIntents.length) {
    recordVersion(meetingId, "intents.replaced", null, priorIntents.map((r) => ({ ...(r as object) })));
  }
  d.prepare(`DELETE FROM shot_coverage WHERE meeting_id = ?`).run(meetingId);
  d.prepare(`DELETE FROM scene_intents WHERE meeting_id = ?`).run(meetingId);

  const insIntent = d.prepare(
    `INSERT INTO scene_intents
       (id, meeting_id, type, text, source_field, evidence, decision_state, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'candidate', 1, ?)`,
  );
  (value.intents ?? []).forEach((it, i) =>
    insIntent.run(
      `INT-${String(i + 1).padStart(2, "0")}`,
      meetingId,
      it.type,
      it.text,
      it.source_field,
      JSON.stringify(it.evidence),
      now(),
    ),
  );

  d.prepare(`UPDATE meetings SET extracted_at = ? WHERE id = ?`).run(now(), meetingId);
  recordVersion(meetingId, "extraction.created", null, value);
}

type Table = "scene_brief_items" | "scene_core_items" | "decisions";

/** 사용자의 수정/승인/보류. ai_value 는 절대 덮어쓰지 않는다. */
export function updateItem(
  table: Table,
  itemId: string,
  patch: { userValue?: string | null; action?: "approve" | "hold" | "reopen" },
  actor = "current_user",
) {
  const d = db();
  const before = plainOne<BriefItemRow & { meeting_id: string }>(
    d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(itemId),
  );
  if (!before) return null;

  let decision_state = before.decision_state;
  let verification_state = before.verification_state;
  let approved_by = before.approved_by;
  let approved_at = before.approved_at;

  if (patch.action === "approve") {
    decision_state = "confirmed";
    verification_state = "approved";
    approved_by = actor;
    approved_at = now();
  } else if (patch.action === "hold") {
    verification_state = "held";
    approved_by = null;
    approved_at = null;
    if (decision_state === "confirmed") decision_state = "candidate";
  } else if (patch.action === "reopen") {
    verification_state = "pending";
    approved_by = null;
    approved_at = null;
    if (decision_state === "confirmed") decision_state = "candidate";
  }

  const userValue =
    patch.userValue === undefined ? before.user_value : (patch.userValue?.trim() || null);

  d.prepare(
    `UPDATE ${table}
        SET user_value = ?, decision_state = ?, verification_state = ?, approved_by = ?, approved_at = ?
      WHERE id = ?`,
  ).run(userValue, decision_state, verification_state, approved_by, approved_at, itemId);

  const after = plainOne<BriefItemRow>(d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(itemId))!;

  // Scene Brief 의 의도가 바뀌면 그 의도를 근거로 확인된 커버리지는 만료된다.
  // 카메라 방향 같은 다른 연출 값 변경으로는 만료시키지 않는다.
  if (table === "scene_brief_items") {
    const intent = plainOne<{ id: string }>(
      d
        .prepare(`SELECT id FROM scene_intents WHERE meeting_id = ? AND source_field = ? LIMIT 1`)
        .get(before.meeting_id, after.field),
    );
    if (intent) bumpIntent(before.meeting_id, intent.id, after.user_value ?? after.ai_value, actor);
  }

  recordVersion(before.meeting_id, `${table}.updated`, itemId, { before, after, actor });
  return after;
}

/** effective_value 는 저장하지 않고 파생한다. 저장하면 ai/user 값과 어긋날 수 있다. */
export const effectiveValue = (row: { ai_value: string; user_value: string | null }) =>
  row.user_value ?? row.ai_value;

// ── Shot Board ────────────────────────────────────────────────────

/**
 * 샷 승인 / 재검토 / 새 버전 생성.
 * 렌즈·구도·카메라 값은 AI 제안이므로 승인 전까지 확정으로 취급하지 않는다.
 */
export function updateShot(
  shotId: string,
  patch: {
    action?: "approve" | "request_review" | "new_version" | "mark_restale";
    fields?: Partial<
      Pick<
        ShotRow,
        | "shot_size"
        | "lens"
        | "camera_height"
        | "camera_move"
        | "character_action"
        | "dialogue_sound"
        | "duration"
        | "purpose"
        | "production_check"
      >
    >;
  },
  actor = "current_user",
) {
  const d = db();
  const before = plainOne<ShotRow>(d.prepare(`SELECT * FROM shots WHERE id = ?`).get(shotId));
  if (!before) return null;

  let status: ShotStatus = before.status;
  let version = before.version;
  let approved_by = before.approved_by;
  let approved_at = before.approved_at;

  if (patch.action === "approve") {
    if (before.image_state !== "generated") {
      // 최종 승인은 상태 표기 문제가 아니라 규칙이다.
      // 이미지 없는 샷을 완성 콘티처럼 승인 표시하면 신뢰가 깨진다.
      throw new Error(
        `쇼트 ${before.shot_number}: 이미지가 생성되지 않아 최종 승인할 수 없습니다 (image_state=${before.image_state}).`,
      );
    }
    status = "approved";
    approved_by = actor;
    approved_at = now();
  } else if (patch.action === "request_review") {
    status = "restale";
    approved_by = null;
    approved_at = null;
  } else if (patch.action === "mark_restale") {
    status = "restale";
    approved_by = null;
    approved_at = null;
  } else if (patch.action === "new_version") {
    status = "proposed";
    version = before.version + 1;
    approved_by = null;
    approved_at = null;
  }

  const f = patch.fields ?? {};
  // 값을 사람이 고치면 그 샷은 다시 승인 대기로 돌아간다.
  if (Object.keys(f).length && !patch.action) {
    status = "proposed";
    approved_by = null;
    approved_at = null;
  }

  d.prepare(
    `UPDATE shots SET
        shot_size = ?, lens = ?, camera_height = ?, camera_move = ?,
        character_action = ?, dialogue_sound = ?, duration = ?, purpose = ?, production_check = ?,
        status = ?, version = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    f.shot_size ?? before.shot_size,
    f.lens ?? before.lens,
    f.camera_height ?? before.camera_height,
    f.camera_move ?? before.camera_move,
    f.character_action ?? before.character_action,
    f.dialogue_sound ?? before.dialogue_sound,
    f.duration ?? before.duration,
    f.purpose ?? before.purpose,
    f.production_check ?? before.production_check,
    status,
    version,
    approved_by,
    approved_at,
    now(),
    shotId,
  );

  const after = plainOne<ShotRow>(d.prepare(`SELECT * FROM shots WHERE id = ?`).get(shotId))!;
  recordVersion(before.meeting_id, "shot.updated", shotId, { before, after, actor });
  return after;
}

// ── Visual References ─────────────────────────────────────────────

export function updateReference(referenceId: string, application: ReferenceApplication) {
  const d = db();
  const before = plainOne<ReferenceRow>(
    d.prepare(`SELECT * FROM visual_references WHERE id = ?`).get(referenceId),
  );
  if (!before) return null;

  d.prepare(`UPDATE visual_references SET application = ?, updated_at = ? WHERE id = ?`).run(
    application,
    now(),
    referenceId,
  );
  const after = plainOne<ReferenceRow>(
    d.prepare(`SELECT * FROM visual_references WHERE id = ?`).get(referenceId),
  )!;
  recordVersion(before.meeting_id, "reference.updated", referenceId, { before, after });
  return after;
}

// ── Scene Issue 해결 ──────────────────────────────────────────────

export function getAlignmentResolution(meetingId: string, issueId = "A-01") {
  return plainOne<AlignmentResolutionRow>(
    db()
      .prepare(`SELECT * FROM alignment_resolutions WHERE meeting_id = ? AND issue_id = ?`)
      .get(meetingId, issueId),
  );
}

export function getAssetImpacts(meetingId: string, issueId = "A-01") {
  return plain<AssetImpactRow>(
    db()
      .prepare(`SELECT * FROM asset_impacts WHERE meeting_id = ? AND issue_id = ? ORDER BY target_id`)
      .all(meetingId, issueId),
  );
}

export function getAlignmentScoreSnapshot(meetingId: string) {
  return plainOne<AlignmentScoreSnapshotRow>(
    db()
      .prepare(
        `SELECT * FROM alignment_score_snapshots WHERE meeting_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(meetingId),
  );
}

/** 해결안이 어떤 Scene Brief 필드를 갱신하는지. 지금은 A-01만 완전히 연결되어 있다. */
// v2 스키마(대문자, SCENE_BRIEF_FIELDS) 기준 — 근거: docs/scene_brief_schema_migration_v1_to_v2.md
const ISSUE_TARGET_FIELD: Record<string, string> = { "A-01": "ACTOR_DIRECTIONS" };

/**
 * 해석 차이 해결 → Scene Brief 갱신 → 영향 자산 '재검토 필요' 표시 → 위험도 재계산.
 * 회의에서 나온 선택지를 사람이 고르는 구조이며, AI가 대신 고르지 않는다.
 */
export function resolveSceneIssue(
  issueId: string,
  input: {
    meetingId: string;
    selectedOption?: string;
    action?: "keep" | "request_revision" | "regenerate";
    actor?: string;
  },
) {
  const d = db();
  const ts = now();
  const meetingId = input.meetingId;
  const actor = input.actor || "current_user";
  const action = input.action || "regenerate";

  const issue = plainOne<SceneIssueRow>(
    d.prepare(`SELECT * FROM scene_issues WHERE meeting_id = ? AND issue_id = ?`).get(meetingId, issueId),
  );
  if (!issue) return null;

  const options: { option: string; resolved_text: string }[] = JSON.parse(issue.positions || "[]");
  const chosen =
    options.find((o) => o.option === input.selectedOption) ?? options[options.length - 1];
  if (!chosen) return null;

  const before = {
    resolution: getAlignmentResolution(meetingId, issueId),
    assetImpacts: getAssetImpacts(meetingId, issueId),
    score: getAlignmentScoreSnapshot(meetingId),
  };

  d.prepare(
    `INSERT INTO alignment_resolutions
      (issue_id, meeting_id, question, selected_option, resolved_text, evidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'resolved', ?, ?)
     ON CONFLICT(issue_id, meeting_id) DO UPDATE SET
       selected_option = excluded.selected_option,
       resolved_text = excluded.resolved_text,
       status = 'resolved',
       updated_at = excluded.updated_at`,
  ).run(
    issueId,
    meetingId,
    issue.question,
    chosen.option,
    chosen.resolved_text,
    issue.evidence,
    ts,
    ts,
  );

  d.prepare(`UPDATE scene_issues SET status = 'resolved' WHERE meeting_id = ? AND issue_id = ?`).run(
    meetingId,
    issueId,
  );

  // Scene Brief 갱신 — 사람이 고른 결과이므로 confirmed + 승인 기록을 남긴다.
  const field = ISSUE_TARGET_FIELD[issueId];
  if (field) {
    const target = plainOne<BriefItemRow>(
      d
        .prepare(`SELECT * FROM scene_brief_items WHERE meeting_id = ? AND field = ? ORDER BY idx LIMIT 1`)
        .get(meetingId, field),
    );
    if (target) {
      d.prepare(
        `UPDATE scene_brief_items
            SET user_value = ?, decision_state = 'confirmed', verification_state = 'approved',
                approved_by = ?, approved_at = ?
          WHERE id = ?`,
      ).run(chosen.resolved_text, actor, ts, target.id);
    }
  }

  // 변경 영향 — 이 결정에 의존하던 자산을 '재검토 필요'로 표시한다.
  const impacted = plain<ShotRow>(
    d.prepare(`SELECT * FROM shots WHERE meeting_id = ? AND evidence LIKE '%U07%' OR (meeting_id = ? AND evidence LIKE '%U08%')`).all(meetingId, meetingId),
  );
  d.prepare(`DELETE FROM asset_impacts WHERE meeting_id = ? AND issue_id = ?`).run(meetingId, issueId);
  const insImpact = d.prepare(
    `INSERT INTO asset_impacts (id, meeting_id, issue_id, asset_type, target_id, label, status, action, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const staleStatus = action === "keep" ? "current" : "stale";
  for (const shot of impacted) {
    insImpact.run(
      uid(),
      meetingId,
      issueId,
      "shot",
      `shot_${shot.shot_number}`,
      `Shot Board · Shot ${String(shot.shot_number).padStart(2, "0")}`,
      staleStatus,
      action,
      ts,
    );
    if (action !== "keep") {
      d.prepare(`UPDATE shots SET status = 'restale', updated_at = ? WHERE id = ?`).run(ts, shot.id);
    }
  }
  insImpact.run(uid(), meetingId, issueId, "previs", "previs_v2", "Previs v2", staleStatus, action, ts);
  insImpact.run(
    uid(),
    meetingId,
    issueId,
    "handoff",
    "handoff_writer",
    "작가 전달 카드 · 마지막 대사 삭제 여부",
    staleStatus,
    action,
    ts,
  );

  // 위험도 — 정밀해 보이는 점수를 만들지 않는다. 열려 있는 항목 수로만 계산한다.
  const openIssues = plainOne<{ n: number }>(
    d.prepare(`SELECT COUNT(*) AS n FROM scene_issues WHERE meeting_id = ? AND status = 'open'`).get(meetingId),
  );
  const openUnresolved = plainOne<{ n: number }>(
    d.prepare(`SELECT COUNT(*) AS n FROM unresolved_items WHERE meeting_id = ?`).get(meetingId),
  );
  const blockedShots = plainOne<{ n: number }>(
    d.prepare(`SELECT COUNT(*) AS n FROM shots WHERE meeting_id = ? AND status IN ('draft','restale')`).get(meetingId),
  );
  const alignment_risk = (openIssues?.n ?? 0) * 3;
  const flow_risk = (openUnresolved?.n ?? 0) * 2 + (blockedShots?.n ?? 0) * 2;
  const score = Math.max(0, Math.min(100, 100 - alignment_risk * 4 - flow_risk * 3));

  d.prepare(
    `INSERT INTO alignment_score_snapshots
      (id, meeting_id, issue_id, alignment_risk, flow_risk, score, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid(),
    meetingId,
    issueId,
    alignment_risk,
    flow_risk,
    score,
    "이 값은 검증된 측정치가 아니라 열려 있는 이슈·미결정·미승인 샷의 개수를 합친 작업 참고 지표입니다.",
    ts,
  );

  const after = {
    resolution: getAlignmentResolution(meetingId, issueId),
    assetImpacts: getAssetImpacts(meetingId, issueId),
    score: getAlignmentScoreSnapshot(meetingId),
  };
  recordVersion(meetingId, "scene_issue.resolved", issueId, { before, after, action, actor });
  return after;
}

export const resolveAlignmentIssue = resolveSceneIssue;
