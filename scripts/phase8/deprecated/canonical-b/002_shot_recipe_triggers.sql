-- Phase 8 제약 트리거. 테스트 브랜치 전용 적용.
-- 근거: docs/phase8_shot_recipe_migration_draft.md §3-4
BEGIN;


-- (T1) 버전 본문 불변 — status 외 컬럼 UPDATE 차단
CREATE OR REPLACE FUNCTION srv_body_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    IF NEW.recipe_id IS DISTINCT FROM OLD.recipe_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.scene_purpose IS DISTINCT FROM OLD.scene_purpose
       OR NEW.emotional_turn IS DISTINCT FROM OLD.emotional_turn
       OR NEW.key_action IS DISTINCT FROM OLD.key_action
       OR NEW.camera_position IS DISTINCT FROM OLD.camera_position
       OR NEW.lens_intent IS DISTINCT FROM OLD.lens_intent
       OR NEW.blocking IS DISTINCT FROM OLD.blocking
       OR NEW.lighting_direction IS DISTINCT FROM OLD.lighting_direction
       OR NEW.edit_point IS DISTINCT FROM OLD.edit_point
       OR NEW.sound_cue IS DISTINCT FROM OLD.sound_cue
       OR NEW.performance_direction IS DISTINCT FROM OLD.performance_direction
       OR NEW.first_frame_description IS DISTINCT FROM OLD.first_frame_description
       OR NEW.first_frame_reference_id IS DISTINCT FROM OLD.first_frame_reference_id
       OR NEW.last_frame_description IS DISTINCT FROM OLD.last_frame_description
       OR NEW.last_frame_reference_id IS DISTINCT FROM OLD.last_frame_reference_id
       OR NEW.camera_path IS DISTINCT FROM OLD.camera_path
       OR NEW.beat_frame_notes IS DISTINCT FROM OLD.beat_frame_notes
       OR NEW.edit_bridge IS DISTINCT FROM OLD.edit_bridge
       OR NEW.split_generation_recommended IS DISTINCT FROM OLD.split_generation_recommended
       OR NEW.motion_segment_plan IS DISTINCT FROM OLD.motion_segment_plan
       OR NEW.partial_regeneration_zones IS DISTINCT FROM OLD.partial_regeneration_zones
       OR NEW.production_method IS DISTINCT FROM OLD.production_method
       OR NEW.post_handoff_elements IS DISTINCT FROM OLD.post_handoff_elements
       OR NEW.handoff_manifest_ref IS DISTINCT FROM OLD.handoff_manifest_ref
       OR NEW.human_decision_owner IS DISTINCT FROM OLD.human_decision_owner
       OR NEW.ai_assisted_elements IS DISTINCT FROM OLD.ai_assisted_elements
       OR NEW.human_authored_elements IS DISTINCT FROM OLD.human_authored_elements
       OR NEW.evidence IS DISTINCT FROM OLD.evidence
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION
        'shot_recipe_versions 본문은 불변입니다. 내용을 바꾸려면 새 버전을 만드십시오. (version_id=%)',
        OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_srv_body_immutable ON shot_recipe_versions;
CREATE TRIGGER trg_srv_body_immutable
  BEFORE UPDATE ON shot_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION srv_body_immutable();

-- (T2) approved 상태는 승인 행이 있어야만 가능
CREATE OR REPLACE FUNCTION srv_approved_requires_approval() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    IF NOT EXISTS (
      SELECT 1 FROM shot_recipe_approvals a
      WHERE a.version_id = NEW.id AND a.decision = 'approved'
    ) THEN
      RAISE EXCEPTION
        'approved 상태는 shot_recipe_approvals 승인 기록이 있어야 합니다. (version_id=%)',
        NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_srv_approved_requires_approval ON shot_recipe_versions;
CREATE TRIGGER trg_srv_approved_requires_approval
  BEFORE UPDATE OF status ON shot_recipe_versions
  FOR EACH ROW EXECUTE FUNCTION srv_approved_requires_approval();

-- (T3) 승인 이력 append-only — UPDATE/DELETE 금지
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

COMMIT;
