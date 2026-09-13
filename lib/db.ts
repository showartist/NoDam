// node:sqlite (Node 22+ 내장). 별도 네이티브 의존성 없이 파일 DB를 쓴다.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = process.env.VERCEL
  ? path.join("/tmp", "scenesync.db")
  : path.join(process.cwd(), ".data", "scenesync.db");
const DB_PATH = process.env.SCENENOTE_DB ?? DEFAULT_DB_PATH;

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, domain TEXT NOT NULL,
      one_line TEXT, created_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT);

    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT,
      raw_transcript TEXT NOT NULL, extracted_at TEXT, created_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS utterances (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, idx INTEGER NOT NULL,
      uid TEXT NOT NULL, speaker_id TEXT, speaker_name TEXT NOT NULL, role TEXT,
      ts_start TEXT, ts_end TEXT, text_raw TEXT NOT NULL, text_clean TEXT NOT NULL,
      stage_direction TEXT);

    -- Scene Brief 항목. ai_value 와 user_value 를 분리 저장한다.
    -- effective_value 는 파생값이므로 저장하지 않는다.
    CREATE TABLE IF NOT EXISTS scene_brief_items (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, field TEXT NOT NULL, idx INTEGER NOT NULL,
      ai_value TEXT NOT NULL, user_value TEXT,
      decision_state TEXT NOT NULL, verification_state TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT, approved_at TEXT,
      evidence TEXT NOT NULL, confidence TEXT NOT NULL, note TEXT);

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, did TEXT NOT NULL,
      ai_value TEXT NOT NULL, user_value TEXT,
      decision_state TEXT NOT NULL, verification_state TEXT NOT NULL DEFAULT 'pending',
      approved_by TEXT, approved_at TEXT,
      evidence TEXT NOT NULL, confidence TEXT NOT NULL, note TEXT);

    CREATE TABLE IF NOT EXISTS unresolved_items (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, nid TEXT NOT NULL,
      subject TEXT NOT NULL, evidence TEXT NOT NULL, question TEXT NOT NULL,
      blocks_roles TEXT NOT NULL DEFAULT '[]');

    -- Shot Board 6컷. 렌즈·구도·카메라 높이·움직임은 AI 확정값이 아니라 제안이다.
    CREATE TABLE IF NOT EXISTS shots (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, shot_number INTEGER NOT NULL,
      -- image_url 은 image_state='not_generated' 일 때 NULL 이다. 이미지가 없는 게 정상 상태다.
      shot_size TEXT NOT NULL, image_url TEXT,
      lens TEXT NOT NULL, camera_height TEXT NOT NULL, camera_move TEXT NOT NULL,
      character_action TEXT NOT NULL, dialogue_sound TEXT NOT NULL, duration TEXT NOT NULL,
      purpose TEXT NOT NULL, production_check TEXT NOT NULL,
      evidence TEXT NOT NULL,
      -- 이 샷이 Scene Brief 의 어떤 항목을 화면에 담는가. 커버리지 검사의 기준이다.
      covers TEXT NOT NULL DEFAULT '[]',
      -- 이미지 상태. not_generated 는 '아직 만들지 않음'이며, 다른 장면 이미지를 빌려오지 않는다.
      -- generated 가 아니면 최종 승인(approved)으로 갈 수 없다.
      image_state TEXT NOT NULL DEFAULT 'not_generated',
      -- Shot Board 는 가변 개수다. 대시보드에 보여줄 대표 컷만 따로 표시한다.
      is_representative INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
      approved_by TEXT, approved_at TEXT, updated_at TEXT NOT NULL);

    -- 레퍼런스 반영 정도는 퍼센트가 아니라 4단계 상태로 관리한다.
    CREATE TABLE IF NOT EXISTS visual_references (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, kind TEXT NOT NULL,
      source TEXT NOT NULL, description TEXT NOT NULL,
      application TEXT NOT NULL DEFAULT 'reference',
      evidence TEXT NOT NULL, updated_at TEXT NOT NULL);


    -- Scene Brief 가 화면으로 지켜야 하는 의도. 바뀌면 version 이 올라간다.
    -- id 는 회의 안에서만 고유한 코드(INT-01 ...)다. 회의 간 충돌하지 않도록 복합 키를 쓴다.
    CREATE TABLE IF NOT EXISTS scene_intents (
      id TEXT NOT NULL, meeting_id TEXT NOT NULL, type TEXT NOT NULL,
      text TEXT NOT NULL, source_field TEXT NOT NULL, evidence TEXT NOT NULL,
      decision_state TEXT NOT NULL DEFAULT 'candidate',
      version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
      PRIMARY KEY (id, meeting_id));

    -- Shot 이 Intent 를 담는다는 '주장'. 확인은 감독 승인으로만 이루어진다.
    CREATE TABLE IF NOT EXISTS shot_coverage (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL,
      shot_id TEXT NOT NULL, intent_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'primary',
      coverage_claimed_by TEXT NOT NULL DEFAULT 'ai',
      coverage_verification_state TEXT NOT NULL DEFAULT 'proposed',
      coverage_approved_by TEXT, coverage_approved_at TEXT,
      intent_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE (shot_id, intent_id, role));

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, kind TEXT NOT NULL,
      target_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS scene_issues (
      issue_id TEXT NOT NULL, meeting_id TEXT NOT NULL, type TEXT NOT NULL,
      subject TEXT NOT NULL, question TEXT NOT NULL, positions TEXT NOT NULL,
      evidence TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      blocks_roles TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (issue_id, meeting_id));

    CREATE TABLE IF NOT EXISTS alignment_resolutions (
      issue_id TEXT NOT NULL, meeting_id TEXT NOT NULL, question TEXT NOT NULL,
      selected_option TEXT NOT NULL, resolved_text TEXT NOT NULL, evidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'resolved',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (issue_id, meeting_id));

    -- 변경 영향. status: stale(재검토 필요) / current(최신) / regenerating(새 버전 생성 중)
    CREATE TABLE IF NOT EXISTS asset_impacts (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, issue_id TEXT NOT NULL,
      asset_type TEXT NOT NULL, target_id TEXT NOT NULL, label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'stale', action TEXT NOT NULL DEFAULT 'regenerate',
      updated_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS alignment_score_snapshots (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, issue_id TEXT,
      alignment_risk INTEGER NOT NULL, flow_risk INTEGER NOT NULL, score INTEGER NOT NULL,
      note TEXT NOT NULL, created_at TEXT NOT NULL);

    -- Sprint 1: Alignment Issues 영속 테이블
    CREATE TABLE IF NOT EXISTS alignment_issues_v2 (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, project_id TEXT NOT NULL,
      scene_ids TEXT NOT NULL, issue_type TEXT NOT NULL, severity TEXT NOT NULL,
      topic TEXT NOT NULL, summary TEXT NOT NULL, participant_positions TEXT NOT NULL,
      evidence_uids TEXT NOT NULL, why_it_matters TEXT NOT NULL, suggested_question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'detected', created_at TEXT NOT NULL);

    -- Sprint 2: Participant Exploration Recipes 영속 테이블
    CREATE TABLE IF NOT EXISTS exploration_recipes_v2 (
      id TEXT PRIMARY KEY, issue_id TEXT NOT NULL, participant_id TEXT NOT NULL,
      participant_name TEXT NOT NULL, participant_role TEXT NOT NULL, interpretation TEXT NOT NULL,
      evidence_uids TEXT NOT NULL, basis TEXT NOT NULL, confidence REAL NOT NULL,
      composition TEXT, subject_presence TEXT, subject_placement TEXT, environment TEXT,
      lighting TEXT, color_intent TEXT, wardrobe TEXT, props TEXT, subject_action TEXT,
      performance_direction TEXT, required_elements TEXT, prohibited_elements TEXT,
      version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL);

    -- Sprint 2: Consolidated Exploration Recipes 영속 테이블
    CREATE TABLE IF NOT EXISTS consolidated_recipes_v2 (
      id TEXT PRIMARY KEY, source_issue_id TEXT NOT NULL, source_recipe_ids TEXT NOT NULL,
      selected_visual_elements TEXT NOT NULL, unresolved_fields TEXT NOT NULL, evidence_uids TEXT NOT NULL,
      compiled_prompt TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft');

    -- Sprint 3: Resolved Decisions 영속 테이블
    CREATE TABLE IF NOT EXISTS resolved_decisions_v2 (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
      scene_ids TEXT NOT NULL, source_issue_ids TEXT NOT NULL, source_exploration_recipe_ids TEXT NOT NULL,
      source_consolidated_recipe_id TEXT NOT NULL, selected_visual_elements TEXT NOT NULL,
      final_answers TEXT NOT NULL, evidence_uids TEXT NOT NULL, decision_summary TEXT NOT NULL,
      resolved_by TEXT NOT NULL, resolved_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft');

    -- Sprint 3: Production Image Recipes 영속 테이블
    CREATE TABLE IF NOT EXISTS production_image_recipes_v2 (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scene_ids TEXT NOT NULL,
      source_resolved_decision_id TEXT NOT NULL, source_shot_recipe_id TEXT,
      version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ready_for_generation',
      composition TEXT, subject_presence TEXT, subject_placement TEXT, environment TEXT,
      lighting TEXT, color_intent TEXT, wardrobe TEXT, props TEXT, subject_action TEXT,
      performance_direction TEXT, required_elements TEXT, prohibited_elements TEXT,
      evidence_uids TEXT NOT NULL, reference_ids TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL);

    CREATE INDEX IF NOT EXISTS idx_utt_meeting ON utterances(meeting_id, idx);
    CREATE INDEX IF NOT EXISTS idx_brief_meeting ON scene_brief_items(meeting_id, idx);
    CREATE INDEX IF NOT EXISTS idx_shots_meeting ON shots(meeting_id, shot_number);
    CREATE INDEX IF NOT EXISTS idx_intents_meeting ON scene_intents(meeting_id, type);
    CREATE INDEX IF NOT EXISTS idx_coverage_meeting ON shot_coverage(meeting_id, intent_id);
    CREATE INDEX IF NOT EXISTS idx_asset_impacts_meeting ON asset_impacts(meeting_id, issue_id);
  `);

  // ── 전사(STT) 컬럼 추가 ────────────────────────────────────────────────
  // CREATE TABLE IF NOT EXISTS 는 이미 만들어진 DB 에 컬럼을 더해주지 않는다.
  // 기존 데모 DB 를 지우지 않고 올리기 위해 여기서 한 번씩 ALTER 한다.
  //
  // start_ms/end_ms 가 canonical 시간이다. 기존 ts_start 문자열은 옛 화면 호환용으로 남긴다.
  // speaker_id 는 diarization identity(SPEAKER_01)이고 speaker_name 은 사람이 붙인 이름이다.
  // 화자 정보를 모르면 speaker_id 는 NULL 이다. 임의 값을 채우지 않는다.
  // speaker_name 은 원래 NOT NULL 이었다. 화자 이름을 모르는 상태(실제 STT 결과)를
  // 저장할 수 없어, "화자1" 같은 가짜 이름을 넣게 만드는 제약이었다. nullable 로 바꾼다.
  relaxSpeakerNameNotNull(d);

  addColumn(d, "utterances", "start_ms", "INTEGER");
  addColumn(d, "utterances", "end_ms", "INTEGER");
  addColumn(d, "utterances", "confidence", "REAL");
  addColumn(d, "utterances", "transcription_provider", "TEXT");
  addColumn(d, "utterances", "transcription_model", "TEXT");
  addColumn(d, "utterances", "source_file_name", "TEXT");
  addColumn(d, "utterances", "created_at", "TEXT");

  d.exec(`
    -- SPEAKER_01 → "대표" 처럼 사람이 붙이는 표시 이름. 회의 단위로 저장한다.
    CREATE TABLE IF NOT EXISTS speaker_mappings (
      meeting_id TEXT NOT NULL,
      speaker_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (meeting_id, speaker_id));

    -- 전사 1회 = 1행. 어떤 파일을 어떤 모델로 처리했고 화자분리가 됐는지 남긴다.
    -- 실제로 호출하지 않은 모델명을 기록하지 않는다.
    CREATE TABLE IF NOT EXISTS transcription_runs (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL,
      language TEXT, source_file_name TEXT, duration_ms INTEGER,
      diarization_status TEXT NOT NULL, speaker_count INTEGER,
      utterance_count INTEGER NOT NULL, created_at TEXT NOT NULL);

    -- 동상이몽 분석 1회 = 1행. status 가 completed 일 때만 결과가 있다.
    CREATE TABLE IF NOT EXISTS alignment_analysis_runs (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL,
      provider TEXT NOT NULL, model TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT,
      issues_json TEXT, agreements_json TEXT,
      created_at TEXT NOT NULL);
  `);

  // ── 해석 차이 탐지 v2 (lib/alignment) ──────────────────────────────────────
  // 분석 1회 = run 1행. run 이 끝나면 그 회의의 "현재 안건 묶음"이 된다.
  // 안건 본문은 AlignmentIssueV2 JSON 그대로 body 에 두고, 목록·필터에 쓰는 값만 컬럼으로 뺀다.
  d.exec(`
    CREATE TABLE IF NOT EXISTS alignment_v2_runs (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL,
      mode TEXT NOT NULL,                 -- batch | window | live
      model TEXT NOT NULL, judge_model TEXT,
      status TEXT NOT NULL,               -- running | completed | failed
      error TEXT,
      data_mode TEXT NOT NULL DEFAULT 'live',
      utterance_count INTEGER, window_count INTEGER, latency_ms INTEGER,
      usage_json TEXT, stats_json TEXT, agreements_json TEXT,
      created_at TEXT NOT NULL, finished_at TEXT);

    CREATE TABLE IF NOT EXISTS alignment_v2_issues (
      run_id TEXT NOT NULL, issue_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
      key TEXT NOT NULL, type TEXT NOT NULL, state TEXT NOT NULL, severity TEXT NOT NULL,
      body TEXT NOT NULL,
      approved_by TEXT, approved_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, issue_id));

    -- 사람이 관점 비교·합의 화면에서 고른 값. AI 는 이 표에 쓰지 않는다.
    CREATE TABLE IF NOT EXISTS alignment_v2_resolutions (
      run_id TEXT NOT NULL, issue_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
      selected_json TEXT NOT NULL,        -- [{slot, value, speakerKey, evidence}]
      answers_json TEXT NOT NULL,         -- [{slot, value, source: 'selected'|'typed'|'ai_suggestion_accepted'}]
      summary TEXT NOT NULL,
      resolved_by TEXT NOT NULL, resolved_at TEXT NOT NULL,
      PRIMARY KEY (run_id, issue_id));

    -- 관점 비교 화면에서 고르는 중인 값. 합의 화면으로 넘어갈 때 읽는다.
    CREATE TABLE IF NOT EXISTS alignment_v2_drafts (
      run_id TEXT NOT NULL, issue_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
      selected_json TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, issue_id));

    -- 승인된 결정의 항목 값. 회의 간 일관성 검사와 변경 이력의 기준이다.
    CREATE TABLE IF NOT EXISTS decision_ledger (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
      run_id TEXT, issue_id TEXT,
      decision TEXT NOT NULL, slot TEXT NOT NULL, value TEXT NOT NULL,
      evidence TEXT NOT NULL,             -- JSON U-ID 배열
      decided_by TEXT NOT NULL, decided_at TEXT NOT NULL,
      superseded_by TEXT,
      embedding TEXT);                    -- JSON float 배열 (bge-m3). 없으면 NULL

    -- 생성 이미지. URL 만 두지 않고 모델·프롬프트·근거를 함께 남긴다 (아키텍처 경계 원칙 3).
    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL,
      run_id TEXT, issue_id TEXT,
      kind TEXT NOT NULL,                 -- perspective | consensus | character
      speaker_key TEXT,
      model TEXT NOT NULL, prompt TEXT NOT NULL, negative TEXT,
      reference_ids TEXT NOT NULL DEFAULT '[]', evidence_uids TEXT NOT NULL DEFAULT '[]',
      resolution TEXT NOT NULL,           -- draft | final
      status TEXT NOT NULL,               -- generating | completed | failed
      error TEXT, file_path TEXT, width INTEGER, height INTEGER,
      similarity_json TEXT, cost_usd REAL,
      created_at TEXT NOT NULL, finished_at TEXT);

    -- 회의에 올린 레퍼런스 이미지. 생성 입력으로는 팀이 올린 것만 쓴다.
    CREATE TABLE IF NOT EXISTS meeting_references (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL,
      title TEXT NOT NULL, source TEXT NOT NULL, uploaded_by TEXT,
      adoption TEXT NOT NULL DEFAULT 'reference',   -- core | partial | reference | excluded
      take_json TEXT NOT NULL DEFAULT '[]',         -- 가져올 요소
      avoid_json TEXT NOT NULL DEFAULT '[]',        -- 가져오지 않을 요소
      file_path TEXT, palette_json TEXT,
      evidence TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL);

    -- 회의 중 입력(마이크 조각 녹음 또는 녹음 파일 재생). 조각마다 전사하고 화자 번호를 잇는다.
    CREATE TABLE IF NOT EXISTS live_sessions (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, run_id TEXT NOT NULL,
      mode TEXT NOT NULL,                 -- mic | replay
      source TEXT, speed REAL,
      status TEXT NOT NULL,               -- recording | stopping | stopped | failed
      registry_json TEXT NOT NULL DEFAULT '[]',
      link_method TEXT,                   -- embedding | unlinked
      error TEXT, started_at TEXT NOT NULL, stopped_at TEXT);

    CREATE TABLE IF NOT EXISTS live_chunks (
      session_id TEXT NOT NULL, idx INTEGER NOT NULL,
      offset_ms INTEGER NOT NULL, duration_ms INTEGER,
      file_path TEXT, status TEXT NOT NULL, error TEXT,
      stt_ms INTEGER, link_json TEXT, utterance_count INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY (session_id, idx));

    -- 판정 모델 캐시. 같은 입력의 판정을 다시 사지 않는다. key 는 입력 해시다.
    CREATE TABLE IF NOT EXISTS llm_cache (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, model TEXT NOT NULL,
      value TEXT NOT NULL, created_at TEXT NOT NULL);

    -- 캐릭터 컨셉 초안(계획서 3-5). 회의 발언에서 모은 인물 묘사와, 그 묘사로 그린 초안의 판(version).
    CREATE TABLE IF NOT EXISTS character_notes (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
      character TEXT NOT NULL, aspect TEXT NOT NULL, value TEXT NOT NULL,
      status TEXT NOT NULL, evidence TEXT NOT NULL, source_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS character_drafts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, character TEXT NOT NULL, version INTEGER NOT NULL,
      image_id TEXT NOT NULL, parent_id TEXT, description_json TEXT NOT NULL, changes_json TEXT NOT NULL,
      similarity_to_parent REAL, adopted_by TEXT, adopted_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_char_notes ON character_notes(project_id, character);
    CREATE INDEX IF NOT EXISTS idx_char_drafts ON character_drafts(project_id, character, version);

    CREATE INDEX IF NOT EXISTS idx_v2_runs_meeting ON alignment_v2_runs(meeting_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_v2_issues_meeting ON alignment_v2_issues(meeting_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_project ON decision_ledger(project_id, slot);
    CREATE INDEX IF NOT EXISTS idx_images_meeting ON generated_images(meeting_id, issue_id);
  `);

  // 긴 회의 전사 방식(direct | chunked_linked | chunked_unlinked | xai_direct). transcription_runs 는 위에서 만든다.
  addColumn(d, "transcription_runs", "method", "TEXT");
  // 라이브 세션을 정지하면 조각을 이어 붙인 전체 녹음 경로. 확정 전사(finalize)에 쓴다.
  addColumn(d, "live_sessions", "full_audio", "TEXT");

  _db = d;
  return d;
}

/**
 * utterances.speaker_name 의 NOT NULL 을 푼다.
 * SQLite 는 제약만 떼는 ALTER 를 지원하지 않아 테이블을 다시 만든다.
 * 이미 nullable 이면 아무것도 하지 않는다.
 */
function relaxSpeakerNameNotNull(d: DatabaseSync): void {
  const cols = d.prepare(`PRAGMA table_info(utterances)`).all() as { name: string; notnull: number }[];
  const col = cols.find((c) => c.name === "speaker_name");
  if (!col || col.notnull === 0) return;

  const names = cols.map((c) => c.name).join(", ");
  d.exec(`
    PRAGMA foreign_keys=off;
    BEGIN;
    CREATE TABLE utterances_new (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, idx INTEGER NOT NULL,
      uid TEXT NOT NULL, speaker_id TEXT, speaker_name TEXT, role TEXT,
      ts_start TEXT, ts_end TEXT, text_raw TEXT NOT NULL, text_clean TEXT NOT NULL,
      stage_direction TEXT, start_ms INTEGER, end_ms INTEGER, confidence REAL,
      transcription_provider TEXT, transcription_model TEXT, source_file_name TEXT, created_at TEXT);
    INSERT INTO utterances_new (${names}) SELECT ${names} FROM utterances;
    DROP TABLE utterances;
    ALTER TABLE utterances_new RENAME TO utterances;
    COMMIT;
    PRAGMA foreign_keys=on;
  `);
}

/** 이미 있으면 조용히 넘어가는 ALTER TABLE. node:sqlite 는 IF NOT EXISTS 를 지원하지 않는다. */
function addColumn(d: DatabaseSync, table: string, column: string, type: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const now = () => new Date().toISOString();

export function recordVersion(
  meetingId: string,
  kind: string,
  targetId: string | null,
  payload: unknown,
) {
  db()
    .prepare(
      `INSERT INTO versions (id, meeting_id, kind, target_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(uid(), meetingId, kind, targetId, JSON.stringify(payload), now());
}
