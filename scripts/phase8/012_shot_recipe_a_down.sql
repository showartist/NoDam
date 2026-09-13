-- Phase 8 — Shot Recipe Canonical v1 (37 fields) 롤백
-- 신규 테이블 9개와 트리거·함수만 제거한다. 기존 16개 테이블은 건드리지 않는다.
BEGIN;

DROP TRIGGER IF EXISTS trg_shot_recipes_consistent_links      ON shot_recipes;
DROP TRIGGER IF EXISTS trg_sra_no_update                      ON shot_recipe_approvals;
DROP TRIGGER IF EXISTS trg_srv_approved_requires_both_roles   ON shot_recipe_versions;
DROP TRIGGER IF EXISTS trg_srv_body_immutable                 ON shot_recipe_versions;

DROP FUNCTION IF EXISTS shot_recipes_consistent_links();
DROP FUNCTION IF EXISTS sra_append_only();
DROP FUNCTION IF EXISTS srv_approved_requires_both_roles();
DROP FUNCTION IF EXISTS srv_body_immutable();

DROP INDEX IF EXISTS idx_sra_latest;
DROP INDEX IF EXISTS idx_srv_status;
DROP INDEX IF EXISTS idx_srv_recipe;
DROP INDEX IF EXISTS idx_shot_recipes_scene;
DROP INDEX IF EXISTS idx_shot_recipes_project;

ALTER TABLE IF EXISTS shot_recipes DROP CONSTRAINT IF EXISTS shot_recipes_current_version_fk;

DROP TABLE IF EXISTS shot_recipe_generation_specs;
DROP TABLE IF EXISTS shot_recipe_version_evidence;
DROP TABLE IF EXISTS shot_recipe_version_references;
DROP TABLE IF EXISTS shot_recipe_version_visual_principles;
DROP TABLE IF EXISTS shot_recipe_version_character_visuals;
DROP TABLE IF EXISTS shot_recipe_version_subjects;
DROP TABLE IF EXISTS shot_recipe_approvals;
DROP TABLE IF EXISTS shot_recipe_versions;
DROP TABLE IF EXISTS shot_recipes;

COMMIT;
