-- Phase 8 — Shot Recipe Canonical v1 (37 fields) 스키마 UP
-- 근거: docs/phase8_canonical_a_mapping.md
-- 적용 대상: 테스트 브랜치 전용. 메인 적용은 별도 승인 후.
BEGIN;

-- ── 1. 계보 헤드 ─────────────────────────────────────────────
-- projectId / sceneId / shotId 를 모두 직접 저장한다 (정본 A #2~#4).
-- 세 값의 일관성은 트리거로 강제한다 (011 파일).
CREATE TABLE IF NOT EXISTS shot_recipes (
  id                 TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  scene_id           TEXT NOT NULL,
  shot_id            TEXT NOT NULL,
  current_version_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT shot_recipes_project_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  CONSTRAINT shot_recipes_scene_fk   FOREIGN KEY (scene_id)   REFERENCES scenes(id)   ON DELETE CASCADE,
  CONSTRAINT shot_recipes_shot_fk    FOREIGN KEY (shot_id)    REFERENCES shots(id)    ON DELETE CASCADE,
  -- MVP: 샷 하나당 레시피 계보 하나
  CONSTRAINT shot_recipes_shot_uq    UNIQUE (shot_id)
);

-- ── 2. 버전 본문 (불변) ──────────────────────────────────────
-- 정본 A 의 스칼라·서술형 필드만 담는다. 관계형 ID 는 링크 테이블로 분리한다.
CREATE TABLE IF NOT EXISTS shot_recipe_versions (
  id                     TEXT PRIMARY KEY,
  recipe_id              TEXT NOT NULL,
  version_no             INTEGER NOT NULL,          -- A#5  version

  narrative_purpose      TEXT,                      -- A#7
  emotional_target       TEXT,                      -- A#8
  framing                TEXT,                      -- A#13
  shot_size              TEXT,                      -- A#14
  lens_intent            TEXT,                      -- A#15
  camera_position        TEXT,                      -- A#16
  camera_movement        TEXT,                      -- A#17
  subject_action         TEXT,                      -- A#18 무엇을 하는가 (B.blocking 의미 통합)
  performance_direction  TEXT,                      -- A#37 어떤 내적 상태·연기 방식으로 하는가
  environment            TEXT,                      -- A#19
  lighting               TEXT,                      -- A#20
  color_intent           TEXT,                      -- A#21
  wardrobe               TEXT,                      -- A#22
  props                  TEXT,                      -- A#23
  start_state            TEXT,                      -- A#24
  end_state              TEXT,                      -- A#25
  duration_seconds       NUMERIC(6,2),              -- A#26
  motion_speed           TEXT,                      -- A#27

  -- 서술형 목록. 관계형 ID 가 아니므로 JSONB 를 쓴다.
  continuity_inputs      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- A#28 (B.beat_frame_notes/edit_bridge 통합)
  allowed_elements       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- A#29
  prohibited_elements    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- A#30
  production_constraints JSONB NOT NULL DEFAULT '[]'::jsonb,  -- A#31

  status                 TEXT NOT NULL DEFAULT 'draft',       -- A#6 유일한 가변 컬럼
  created_by             TEXT NOT NULL,                       -- A#33 (B.human_decision_owner 통합)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),  -- A#34

  CONSTRAINT srv_recipe_fk     FOREIGN KEY (recipe_id)  REFERENCES shot_recipes(id) ON DELETE CASCADE,
  CONSTRAINT srv_created_by_fk FOREIGN KEY (created_by) REFERENCES participants(id) ON DELETE RESTRICT,

  CONSTRAINT srv_version_uq            UNIQUE (recipe_id, version_no),
  CONSTRAINT srv_version_positive_chk  CHECK (version_no >= 1),
  CONSTRAINT srv_status_chk            CHECK (status IN ('draft','proposed','needs_review','approved','stale')),
  CONSTRAINT srv_duration_chk          CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  -- 서술형 목록은 배열이어야 한다 (객체·스칼라 금지).
  CONSTRAINT srv_continuity_arr_chk    CHECK (jsonb_typeof(continuity_inputs) = 'array'),
  CONSTRAINT srv_allowed_arr_chk       CHECK (jsonb_typeof(allowed_elements) = 'array'),
  CONSTRAINT srv_prohibited_arr_chk    CHECK (jsonb_typeof(prohibited_elements) = 'array'),
  CONSTRAINT srv_constraints_arr_chk   CHECK (jsonb_typeof(production_constraints) = 'array')
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shot_recipes_current_version_fk') THEN
    ALTER TABLE shot_recipes
      ADD CONSTRAINT shot_recipes_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES shot_recipe_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. 승인 이벤트 (append-only, 역할 구분) ──────────────────
-- A#35 approvedBy / A#36 approvedAt 은 본문 컬럼이 아니라 이 이벤트에서 계산한다.
CREATE TABLE IF NOT EXISTS shot_recipe_approvals (
  id            TEXT PRIMARY KEY,
  version_id    TEXT NOT NULL,
  approver_role TEXT NOT NULL,
  decision      TEXT NOT NULL,
  approved_by   TEXT NOT NULL,
  approved_at   TIMESTAMPTZ NOT NULL,
  rationale     TEXT,
  evidence      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 승인 이력이 있는 버전은 물리 삭제를 막는다 (결정 2).
  CONSTRAINT sra_version_fk     FOREIGN KEY (version_id)  REFERENCES shot_recipe_versions(id) ON DELETE RESTRICT,
  CONSTRAINT sra_approver_fk    FOREIGN KEY (approved_by) REFERENCES participants(id)         ON DELETE RESTRICT,
  CONSTRAINT sra_role_chk       CHECK (approver_role IN ('director','producer')),
  CONSTRAINT sra_decision_chk   CHECK (decision IN ('approved','revoked'))
);

-- ── 4. 관계형 링크 테이블 5종 ────────────────────────────────
-- 관계형 ID 를 JSONB 에 묻지 않는다.

-- A#9 subjectIds — 캐릭터 정체성 테이블이 아직 없어 FK 를 걸 수 없다 (문서 §1 참조).
CREATE TABLE IF NOT EXISTS shot_recipe_version_subjects (
  version_id   TEXT NOT NULL,
  character_id TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT srvs_pk      PRIMARY KEY (version_id, character_id),
  CONSTRAINT srvs_ver_fk  FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE CASCADE
);

-- A#10 characterVisualVersionIds
CREATE TABLE IF NOT EXISTS shot_recipe_version_character_visuals (
  version_id               TEXT NOT NULL,
  character_visual_bible_id TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT srvcv_pk      PRIMARY KEY (version_id, character_visual_bible_id),
  CONSTRAINT srvcv_ver_fk  FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE CASCADE,
  -- 승인된 Recipe 가 참조하는 Bible 은 물리 삭제할 수 없다.
  CONSTRAINT srvcv_cvb_fk  FOREIGN KEY (character_visual_bible_id) REFERENCES character_visual_bibles(id) ON DELETE RESTRICT
);

-- A#11 visualPrincipleVersionIds
CREATE TABLE IF NOT EXISTS shot_recipe_version_visual_principles (
  version_id           TEXT NOT NULL,
  principle_version_id TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT srvvp_pk     PRIMARY KEY (version_id, principle_version_id),
  CONSTRAINT srvvp_ver_fk FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE CASCADE,
  CONSTRAINT srvvp_pv_fk  FOREIGN KEY (principle_version_id) REFERENCES visual_principle_versions(id) ON DELETE RESTRICT
);

-- A#12 referenceIds — B 의 first/last frame 참조를 role 로 흡수한다.
CREATE TABLE IF NOT EXISTS shot_recipe_version_references (
  version_id   TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'general',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT srvr_pk      PRIMARY KEY (version_id, reference_id, role),
  CONSTRAINT srvr_ver_fk  FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE CASCADE,
  -- 결정 1: 참조 중인 Reference 물리 삭제 금지.
  CONSTRAINT srvr_ref_fk  FOREIGN KEY (reference_id) REFERENCES visual_references(id) ON DELETE RESTRICT,
  CONSTRAINT srvr_role_chk CHECK (role IN ('first_frame','last_frame','general'))
);

-- A#32 evidenceIds — U-ID 는 대응 테이블이 없어 TEXT 로 둔다.
CREATE TABLE IF NOT EXISTS shot_recipe_version_evidence (
  version_id   TEXT NOT NULL,
  evidence_uid TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT srve_pk     PRIMARY KEY (version_id, evidence_uid),
  CONSTRAINT srve_ver_fk FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE CASCADE
);

-- ── 5. 생성·실행 설정 (정본 B 이관분) ────────────────────────
-- Shot Recipe 본문이 아니라 실행 스펙이다. 버전당 0~1개.
CREATE TABLE IF NOT EXISTS shot_recipe_generation_specs (
  version_id                   TEXT PRIMARY KEY,
  production_method            TEXT,
  split_generation_recommended BOOLEAN NOT NULL DEFAULT false,
  motion_segment_plan          TEXT,
  partial_regeneration_zones   JSONB NOT NULL DEFAULT '[]'::jsonb,
  sound_cue                    TEXT,
  edit_point                   TEXT,
  post_handoff_elements        JSONB NOT NULL DEFAULT '[]'::jsonb,
  handoff_manifest_ref         TEXT,
  ai_assisted_elements         JSONB NOT NULL DEFAULT '[]'::jsonb,
  human_authored_elements      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT srgs_ver_fk    FOREIGN KEY (version_id) REFERENCES shot_recipe_versions(id) ON DELETE CASCADE,
  CONSTRAINT srgs_method_chk CHECK (production_method IS NULL
    OR production_method IN ('practical','stock','ai_generation','hybrid'))
);

-- ── 6. 인덱스 ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_shot_recipes_project ON shot_recipes(project_id);
CREATE INDEX IF NOT EXISTS idx_shot_recipes_scene   ON shot_recipes(scene_id);
CREATE INDEX IF NOT EXISTS idx_srv_recipe           ON shot_recipe_versions(recipe_id, version_no DESC);
CREATE INDEX IF NOT EXISTS idx_srv_status           ON shot_recipe_versions(status);
-- 역할별 최신 이벤트 조회용
CREATE INDEX IF NOT EXISTS idx_sra_latest           ON shot_recipe_approvals(version_id, approver_role, approved_at DESC, id DESC);

COMMIT;
