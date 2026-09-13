-- Phase 8A — Character Identity 정본 (characters)
-- 근거: docs/phase8a_characters_migration_draft.md
-- 적용 대상: 테스트 브랜치 전용. 메인 적용은 별도 승인 후.
--
-- 역할 분리
--   characters              작품 속 캐릭터의 "정체성" 정본
--   character_visual_bibles 캐릭터 "외형"의 버전 자산 (기존)
BEGIN;

CREATE TABLE IF NOT EXISTS characters (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  name           TEXT NOT NULL,
  character_type TEXT NOT NULL DEFAULT 'supporting',
  status         TEXT NOT NULL DEFAULT 'candidate',
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT characters_project_fk    FOREIGN KEY (project_id) REFERENCES projects(id)     ON DELETE RESTRICT,
  CONSTRAINT characters_created_by_fk FOREIGN KEY (created_by) REFERENCES participants(id) ON DELETE RESTRICT,
  CONSTRAINT characters_type_chk   CHECK (character_type IN ('lead','supporting','extra')),
  CONSTRAINT characters_status_chk CHECK (status IN ('candidate','confirmed','archived')),
  -- 같은 작품 안에서 이름은 유일하다.
  CONSTRAINT characters_project_name_uq UNIQUE (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);

-- shot_recipe_version_subjects.character_id 를 FK 로 승격한다.
-- 사용 중인 캐릭터는 물리 삭제할 수 없다 (RESTRICT).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'srvs_character_fk') THEN
    ALTER TABLE shot_recipe_version_subjects
      ADD CONSTRAINT srvs_character_fk
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 프로젝트 경계 일치 — 다른 프로젝트 캐릭터를 Recipe 에 연결할 수 없다.
CREATE OR REPLACE FUNCTION srvs_same_project() RETURNS TRIGGER AS $$
DECLARE
  recipe_project    TEXT;
  character_project TEXT;
BEGIN
  SELECT r.project_id INTO recipe_project
  FROM shot_recipe_versions v JOIN shot_recipes r ON r.id = v.recipe_id
  WHERE v.id = NEW.version_id;

  SELECT project_id INTO character_project FROM characters WHERE id = NEW.character_id;

  IF recipe_project IS DISTINCT FROM character_project THEN
    RAISE EXCEPTION
      '다른 프로젝트의 캐릭터는 연결할 수 없습니다. (recipe.project=%, character.project=%)',
      COALESCE(recipe_project, '없음'), COALESCE(character_project, '없음');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_srvs_same_project ON shot_recipe_version_subjects;
CREATE TRIGGER trg_srvs_same_project
  BEFORE INSERT OR UPDATE ON shot_recipe_version_subjects
  FOR EACH ROW EXECUTE FUNCTION srvs_same_project();

COMMIT;

-- ⚠️ character_visual_bibles.character_id 의 FK 전환은 이 migration 에 포함하지 않는다.
--    호환성 감사 결과와 결정 사항은 docs/phase8a_characters_migration_draft.md §3 참조.
--    컬럼 타입·데이터를 조용히 바꾸지 않는다.
