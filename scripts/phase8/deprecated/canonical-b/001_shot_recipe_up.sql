-- Phase 8 — Shot Recipe 스키마 (UP)
-- 근거: docs/phase8_shot_recipe_migration_draft.md §3
-- 적용 대상: 테스트 브랜치 전용. 메인 적용은 별도 승인 후.
BEGIN;

-- 3-1. 레시피 계보 헤드 (샷당 1개)
CREATE TABLE IF NOT EXISTS shot_recipes (
  id                 TEXT PRIMARY KEY,
  shot_id            TEXT NOT NULL,
  project_id         TEXT NOT NULL,
  current_version_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT shot_recipes_shot_fk
    FOREIGN KEY (shot_id) REFERENCES shots(id) ON DELETE CASCADE,
  CONSTRAINT shot_recipes_project_fk
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT shot_recipes_shot_uq UNIQUE (shot_id)
);

-- 3-2. 버전 본문 (불변)
CREATE TABLE IF NOT EXISTS shot_recipe_versions (
  id                            TEXT PRIMARY KEY,
  recipe_id                     TEXT NOT NULL,
  version_no                    INTEGER NOT NULL,

  scene_purpose                 TEXT,
  emotional_turn                TEXT,
  key_action                    TEXT,
  camera_position               TEXT,
  lens_intent                   TEXT,
  blocking                      TEXT,
  lighting_direction            TEXT,
  edit_point                    TEXT,
  sound_cue                     TEXT,
  performance_direction         TEXT,

  first_frame_description       TEXT,
  first_frame_reference_id      TEXT,
  last_frame_description        TEXT,
  last_frame_reference_id       TEXT,
  camera_path                   TEXT,
  beat_frame_notes              TEXT,
  edit_bridge                   TEXT,

  split_generation_recommended  BOOLEAN NOT NULL DEFAULT false,
  motion_segment_plan           TEXT,
  partial_regeneration_zones    JSONB NOT NULL DEFAULT '[]'::jsonb,
  production_method             TEXT,

  post_handoff_elements         JSONB NOT NULL DEFAULT '[]'::jsonb,
  handoff_manifest_ref          TEXT,

  human_decision_owner          TEXT NOT NULL,
  ai_assisted_elements          JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_authored_elements       JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence                      JSONB NOT NULL DEFAULT '[]'::jsonb,

  status                        TEXT NOT NULL DEFAULT 'draft',
  created_by                    TEXT NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT srv_recipe_fk
    FOREIGN KEY (recipe_id) REFERENCES shot_recipes(id) ON DELETE CASCADE,
  -- 결정 1: 승인 당시 사용된 Reference 연결을 NULL 로 훼손하지 않는다.
  -- 참조 중인 visual_references 는 물리 삭제를 금지한다 (SET NULL → RESTRICT).
  CONSTRAINT srv_first_frame_fk
    FOREIGN KEY (first_frame_reference_id) REFERENCES visual_references(id) ON DELETE RESTRICT,
  CONSTRAINT srv_last_frame_fk
    FOREIGN KEY (last_frame_reference_id) REFERENCES visual_references(id) ON DELETE RESTRICT,

  CONSTRAINT srv_version_uq UNIQUE (recipe_id, version_no),
  CONSTRAINT srv_version_positive_chk CHECK (version_no >= 1),
  CONSTRAINT srv_status_chk
    CHECK (status IN ('draft','proposed','needs_review','approved','stale')),
  CONSTRAINT srv_method_chk
    CHECK (production_method IS NULL
           OR production_method IN ('practical','stock','ai_generation','hybrid'))
);

-- current_version_id 는 versions 테이블 생성 후에만 FK 를 걸 수 있다.
-- 재적용 시 중복 추가를 피하기 위해 존재 여부를 확인한다 (T-16 멱등성).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shot_recipes_current_version_fk'
  ) THEN
    ALTER TABLE shot_recipes
      ADD CONSTRAINT shot_recipes_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES shot_recipe_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3-3. 승인 이력 (append-only)
CREATE TABLE IF NOT EXISTS shot_recipe_approvals (
  id          TEXT PRIMARY KEY,
  version_id  TEXT NOT NULL,
  decision    TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  rationale   TEXT,
  evidence    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 결정 2: 상위 CASCADE 가 append-only 승인 이력을 지우게 두지 않는다.
  -- 승인 이력이 있는 Version·Shot·Scene·Project 는 물리 삭제를 금지한다 (CASCADE → RESTRICT).
  -- 승인 이력이 없는 draft 데이터는 기존 CASCADE 경로로 정리된다.
  CONSTRAINT sra_version_fk
    FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE RESTRICT,
  CONSTRAINT sra_decision_chk CHECK (decision IN ('approved','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_shot_recipes_project  ON shot_recipes(project_id);
CREATE INDEX IF NOT EXISTS idx_srv_recipe            ON shot_recipe_versions(recipe_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_srv_status            ON shot_recipe_versions(status);
CREATE INDEX IF NOT EXISTS idx_sra_version           ON shot_recipe_approvals(version_id, approved_at DESC);

COMMIT;
