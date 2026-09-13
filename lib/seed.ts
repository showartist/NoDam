// 활성 기본 샘플. 두 회의는 서로의 데이터·이미지·ID 를 절대 공유하지 않는다.
//   m_01 → fixtures/film/scene34_empty_pool.v2.json  (발표 시연 회의 · SCENE 34 실내 수영장)
//   m_02 → fixtures/film/scene12_motel_room.v2.json  (비교용 보조 회의 · SCENE 12 모텔방)
// .v2.json 은 lib/migrate-scene-brief.ts 로 원본(.json, v1 소문자 스키마)에서 변환한 결과다.
// scene_brief_items.field 는 lib/types.ts SCENE_BRIEF_FIELDS(대문자)와 일치해야 하므로
// v1 원본을 직접 시드하지 않는다 — 근거: docs/scene_brief_schema_migration_v1_to_v2.md
// 과거 공연 샘플(fixtures/archive/*)은 UI·기본 DB·계약 테스트에 절대 올리지 않는다.
import { db, now, uid } from "./db";
import { createProject } from "./store";
import scene12 from "@/fixtures/film/scene12_motel_room.v2.json";
import scene34 from "@/fixtures/film/scene34_empty_pool.v2.json";

export const DEMO_MEETING_ID = "m_01";
export const SCENE12_MEETING_ID = "m_02";
export const FILM_TRANSCRIPT = scene34.transcript;

type Approval = { by: string; at_utterance: string; role?: string } | null;
type BriefRow = [string, string, string, string[], string, string | null, Approval?];
type UnresolvedRow = [string, string, string[], string, string[]];
type ReferenceRow = [string, string, string, string, string[]];
type ShotFixture = {
  n: number;
  size: string;
  lens: string;
  height: string;
  move: string;
  action: string;
  sound: string;
  duration: string;
  purpose: string;
  check: string;
  evidence: string[];
  representative?: boolean;
  status?: string;
  /** 없으면 not_generated. 실제 이미지가 있는 장면(SCENE 12)만 명시적으로 넘긴다. */
  image_url?: string;
  image_state?: "not_generated" | "generating" | "generated";
};
type IntentFixture = { id?: string; type: string; text: string; source_field: string; evidence: string[] };
type CoverageFixture = {
  shot: number;
  intent: string;
  role: string;
  claimed_by: string;
  state: string;
  approved_by?: string;
};
type IssueFixture = {
  id: string;
  type: string;
  detection_signal?: string;
  detection_reason?: string;
  subject: string;
  question: string;
  positions: unknown[];
  evidence: string[];
  severity: string;
  status: string;
  blocks: string[];
};
type FilmFixture = {
  project: { title: string; domain: string; one_line: string; participants: { name: string; role: string }[] };
  transcript: string;
  brief: BriefRow[];
  decisions: BriefRow[];
  unresolved: UnresolvedRow[];
  shots: ShotFixture[];
  intents: IntentFixture[];
  coverage: CoverageFixture[];
  references: ReferenceRow[];
  issues: IssueFixture[];
};

/** 한 회의 전체를 fixture 로부터 시드한다. meetingId 는 fixture 간에 절대 공유되지 않는다. */
function seedMeetingFromFixture(meetingId: string, fixture: FilmFixture) {
  const d = db();
  if (d.prepare(`SELECT id FROM meetings WHERE id = ?`).get(meetingId)) return false;

  createProject({
    title: fixture.project.title,
    domain: fixture.project.domain,
    oneLine: fixture.project.one_line,
    participants: fixture.project.participants,
    transcript: fixture.transcript,
    meetingId,
  });

  const ts = now();

  const insBrief = d.prepare(
    `INSERT INTO scene_brief_items
       (id, meeting_id, field, idx, ai_value, decision_state, evidence, confidence, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  fixture.brief.forEach(([field, value, state, evidence, conf, note], i) =>
    insBrief.run(uid(), meetingId, field, i, value, state, JSON.stringify(evidence), conf, note ?? null),
  );

  // confirmed 는 승인 메타데이터와 함께여야 한다. 승인 없는 confirmed 는 규칙 위반이다.
  const insDec = d.prepare(
    `INSERT INTO decisions
       (id, meeting_id, did, ai_value, decision_state, verification_state,
        approved_by, approved_at, evidence, confidence, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  fixture.decisions.forEach(([did, value, state, evidence, conf, note, approval]) => {
    if (state === "confirmed" && !approval) {
      throw new Error(`시드 ${did}(${meetingId}): confirmed 인데 승인 정보가 없습니다.`);
    }
    insDec.run(
      uid(), meetingId, did, value, state,
      approval ? "approved" : "pending",
      approval?.by ?? null,
      approval ? ts : null,
      JSON.stringify(evidence), conf, note ?? null,
    );
  });

  const insUn = d.prepare(
    `INSERT INTO unresolved_items (id, meeting_id, nid, subject, evidence, question, blocks_roles)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  fixture.unresolved.forEach(([nid, subject, evidence, question, blocks]) =>
    insUn.run(uid(), meetingId, nid, subject, JSON.stringify(evidence), question, JSON.stringify(blocks)),
  );

  // Shot Board 는 가변 개수다. image_url/image_state 가 없는 샷은 not_generated 로 시드한다 —
  // 다른 장면의 이미지를 빌려오지 않는다.
  const insShot = d.prepare(
    `INSERT INTO shots
       (id, meeting_id, shot_number, shot_size, image_url, lens, camera_height, camera_move,
        character_action, dialogue_sound, duration, purpose, production_check, evidence, covers,
        is_representative, image_state, status, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, ?)`,
  );
  const shotIdByNumber = new Map<number, string>();
  for (const s of fixture.shots) {
    const id = uid();
    shotIdByNumber.set(s.n, id);
    const imageState = s.image_state ?? (s.image_url ? "generated" : "not_generated");
    if (imageState !== "not_generated" && !s.image_url) {
      throw new Error(`시드 쇼트 ${s.n}(${meetingId}): image_state='${imageState}' 인데 image_url 이 없습니다.`);
    }
    insShot.run(
      id, meetingId, s.n, s.size, s.image_url ?? null, s.lens, s.height, s.move,
      s.action, s.sound, s.duration, s.purpose, s.check,
      JSON.stringify(s.evidence), s.representative ? 1 : 0, imageState, s.status ?? "proposed", ts,
    );
  }

  // Scene Brief 의 의도 — 이것이 화면에 담겼는지가 커버리지 검사의 대상이다.
  const insIntent = d.prepare(
    `INSERT INTO scene_intents
       (id, meeting_id, type, text, source_field, evidence, decision_state, version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const intentIdByType = new Map<string, string>();
  fixture.intents.forEach((it, i) => {
    const intentId = it.id ?? `INT-${String(i + 1).padStart(2, "0")}`;
    intentIdByType.set(it.type, intentId);
    insIntent.run(intentId, meetingId, it.type, it.text, it.source_field, JSON.stringify(it.evidence), "candidate", 1, ts);
  });

  // 커버리지 주장. AI 제안은 proposed 로만 들어간다 — verified 는 감독 승인으로만.
  const insCov = d.prepare(
    `INSERT INTO shot_coverage
       (id, meeting_id, shot_id, intent_id, role, coverage_claimed_by,
        coverage_verification_state, coverage_approved_by, coverage_approved_at,
        intent_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  );
  for (const c of fixture.coverage) {
    const shotId = shotIdByNumber.get(c.shot);
    if (!shotId) continue;
    const intentId = intentIdByType.get(c.intent) ?? c.intent;
    const verified = c.state === "verified";
    const approvedBy = c.approved_by ?? null;
    // 주장(claimed_by)과 확인(approved_by)은 다른 사람이다.
    if (verified && !approvedBy) {
      throw new Error(`시드 커버리지(${meetingId} 쇼트 ${c.shot}): verified 인데 승인자가 없습니다.`);
    }
    if (c.claimed_by === "ai" && verified) {
      throw new Error(`시드 커버리지(${meetingId} 쇼트 ${c.shot}): AI 주장이 스스로 verified 일 수 없습니다.`);
    }
    insCov.run(uid(), meetingId, shotId, intentId, c.role, c.claimed_by, c.state, approvedBy, verified ? ts : null, ts);
  }

  const insRef = d.prepare(
    `INSERT INTO visual_references (id, meeting_id, kind, source, description, application, evidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  fixture.references.forEach(([kind, source, description, application, evidence]) =>
    insRef.run(uid(), meetingId, kind, source, description, application, JSON.stringify(evidence), ts),
  );

  const insIssue = d.prepare(
    `INSERT INTO scene_issues
       (issue_id, meeting_id, type, subject, question, positions, evidence, severity, status, blocks_roles)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const it of fixture.issues) {
    insIssue.run(
      it.id, meetingId, it.type, it.subject, it.question,
      JSON.stringify(it.positions), JSON.stringify(it.evidence),
      it.severity, it.status, JSON.stringify(it.blocks),
    );
  }

  d.prepare(`UPDATE meetings SET extracted_at = ? WHERE id = ?`).run(ts, meetingId);
  return true;
}

/**
 * m_01 = 발표 시연 회의. SCENE 34 · INT. 실내 수영장 · NIGHT.
 * 1~5단계 전 화면이 같은 장면을 가리키도록 수영장 픽스처를 쓴다.
 */
export function ensureSeed(meetingId = DEMO_MEETING_ID) {
  return seedMeetingFromFixture(meetingId, scene34 as unknown as FilmFixture);
}

/** m_02 = 비교용 보조 회의. SCENE 12 모텔방. 발표 흐름에는 쓰지 않는다. */
export function ensureScene12Seed(meetingId = SCENE12_MEETING_ID) {
  return seedMeetingFromFixture(meetingId, scene12 as unknown as FilmFixture);
}

const SEEDED_TABLES = [
  "utterances", "scene_brief_items", "decisions", "unresolved_items",
  "shots", "visual_references", "scene_issues", "scene_intents", "shot_coverage",
  "alignment_resolutions", "asset_impacts", "alignment_score_snapshots", "versions",
];

/** 강제 재시드 — 데모 데이터를 초기 상태로 되돌린다. */
export function reseed(meetingId = DEMO_MEETING_ID) {
  const d = db();
  for (const t of SEEDED_TABLES) d.prepare(`DELETE FROM ${t} WHERE meeting_id = ?`).run(meetingId);
  d.prepare(`DELETE FROM meetings WHERE id = ?`).run(meetingId);
  return meetingId === SCENE12_MEETING_ID ? ensureScene12Seed(meetingId) : ensureSeed(meetingId);
}
