-- Phase 8 — Shot Recipe Canonical v1 (37 fields) 제약 트리거
-- CHECK 로 표현할 수 없는 불변식을 강제한다. 테스트 브랜치 전용 적용.
BEGIN;

-- ────────────────────────────────────────────────────────────
-- T1. 버전 본문 불변 — status 외 컬럼 UPDATE 차단
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION srv_body_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.recipe_id              IS DISTINCT FROM OLD.recipe_id
  OR NEW.version_no             IS DISTINCT FROM OLD.version_no
  OR NEW.narrative_purpose      IS DISTINCT FROM OLD.narrative_purpose
  OR NEW.emotional_target       IS DISTINCT FROM OLD.emotional_target
  OR NEW.framing                IS DISTINCT FROM OLD.framing
  OR NEW.shot_size              IS DISTINCT FROM OLD.shot_size
  OR NEW.lens_intent            IS DISTINCT FROM OLD.lens_intent
  OR NEW.camera_position        IS DISTINCT FROM OLD.camera_position
  OR NEW.camera_movement        IS DISTINCT FROM OLD.camera_movement
  OR NEW.subject_action         IS DISTINCT FROM OLD.subject_action
  OR NEW.performance_direction  IS DISTINCT FROM OLD.performance_direction
  OR NEW.environment            IS DISTINCT FROM OLD.environment
  OR NEW.lighting               IS DISTINCT FROM OLD.lighting
  OR NEW.color_intent           IS DISTINCT FROM OLD.color_intent
  OR NEW.wardrobe               IS DISTINCT FROM OLD.wardrobe
  OR NEW.props                  IS DISTINCT FROM OLD.props
  OR NEW.start_state            IS DISTINCT FROM OLD.start_state
  OR NEW.end_state              IS DISTINCT FROM OLD.end_state
  OR NEW.duration_seconds       IS DISTINCT FROM OLD.duration_seconds
  OR NEW.motion_speed           IS DISTINCT FROM OLD.motion_speed
  OR NEW.continuity_inputs      IS DISTINCT FROM OLD.continuity_inputs
  OR NEW.allowed_elements       IS DISTINCT FROM OLD.allowed_elements
  OR NEW.prohibited_elements    IS DISTINCT FROM OLD.prohibited_elements
  OR NEW.production_constraints IS DISTINCT FROM OLD.production_constraints
  OR NEW.created_by             IS DISTINCT FROM OLD.created_by
  OR NEW.created_at             IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'shot_recipe_versions 본문은 불변입니다. 내용을 바꾸려면 새 버전을 만드십시오. (version_id=%)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_srv_body_immutable ON shot_recipe_versions;
CREATE TRIGGER trg_srv_body_immutable
  BEFORE UPDATE ON shot_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION srv_body_immutable();

-- ────────────────────────────────────────────────────────────
-- T2. approved 는 역할별 최신 승인 2건이 모두 있어야 한다
--
--   구멍 A 차단: BEFORE INSERT 도 감시한다 (직접 INSERT 우회 금지)
--   구멍 B 차단: approver_role 로 director / producer 를 각각 요구
--   구멍 C 차단: EXISTS 가 아니라 역할별 "최신" 이벤트만 평가
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION srv_approved_requires_both_roles() RETURNS TRIGGER AS $$
DECLARE
  latest_director TEXT;
  latest_producer TEXT;
BEGIN
  IF NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT decision INTO latest_director
  FROM shot_recipe_approvals
  WHERE version_id = NEW.id AND approver_role = 'director'
  ORDER BY approved_at DESC, id DESC
  LIMIT 1;

  SELECT decision INTO latest_producer
  FROM shot_recipe_approvals
  WHERE version_id = NEW.id AND approver_role = 'producer'
  ORDER BY approved_at DESC, id DESC
  LIMIT 1;

  IF latest_director IS DISTINCT FROM 'approved' OR latest_producer IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION
      'approved 는 감독·제작의 최신 승인이 모두 있어야 합니다. (version_id=%, director=%, producer=%)',
      NEW.id, COALESCE(latest_director, '없음'), COALESCE(latest_producer, '없음');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_srv_approved_requires_both_roles ON shot_recipe_versions;
CREATE TRIGGER trg_srv_approved_requires_both_roles
  BEFORE INSERT OR UPDATE OF status ON shot_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION srv_approved_requires_both_roles();

-- ────────────────────────────────────────────────────────────
-- T3. 승인 이력 append-only — UPDATE/DELETE 금지
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sra_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'shot_recipe_approvals 는 append-only 입니다. 철회는 decision=''revoked'' 새 행으로 기록하십시오.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sra_no_update ON shot_recipe_approvals;
CREATE TRIGGER trg_sra_no_update
  BEFORE UPDATE OR DELETE ON shot_recipe_approvals
  FOR EACH ROW EXECUTE FUNCTION sra_append_only();

-- ────────────────────────────────────────────────────────────
-- T4. project / scene / shot 일관성
--
--   recipe.scene_id  = shot.scene_id
--   recipe.project_id = scene.project_id
--   불일치 Recipe 생성·수정을 거부한다.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION shot_recipes_consistent_links() RETURNS TRIGGER AS $$
DECLARE
  shot_scene   TEXT;
  scene_project TEXT;
BEGIN
  SELECT scene_id INTO shot_scene FROM shots WHERE id = NEW.shot_id;
  IF shot_scene IS NULL THEN
    RAISE EXCEPTION 'Shot 이 Scene 에 속해 있지 않습니다. (shot_id=%)', NEW.shot_id;
  END IF;
  IF shot_scene IS DISTINCT FROM NEW.scene_id THEN
    RAISE EXCEPTION
      'Recipe 의 scene_id 가 Shot 의 Scene 과 다릅니다. (recipe.scene_id=%, shot.scene_id=%)',
      NEW.scene_id, shot_scene;
  END IF;

  SELECT project_id INTO scene_project FROM scenes WHERE id = NEW.scene_id;
  IF scene_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION
      'Recipe 의 project_id 가 Scene 의 Project 와 다릅니다. (recipe.project_id=%, scene.project_id=%)',
      NEW.project_id, scene_project;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shot_recipes_consistent_links ON shot_recipes;
CREATE TRIGGER trg_shot_recipes_consistent_links
  BEFORE INSERT OR UPDATE OF project_id, scene_id, shot_id ON shot_recipes
  FOR EACH ROW EXECUTE FUNCTION shot_recipes_consistent_links();

COMMIT;
