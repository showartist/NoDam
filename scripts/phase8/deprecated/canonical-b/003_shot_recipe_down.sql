BEGIN;

DROP TRIGGER IF EXISTS trg_sra_no_update                  ON shot_recipe_approvals;
DROP TRIGGER IF EXISTS trg_srv_approved_requires_approval ON shot_recipe_versions;
DROP TRIGGER IF EXISTS trg_srv_body_immutable             ON shot_recipe_versions;
DROP FUNCTION IF EXISTS sra_append_only();
DROP FUNCTION IF EXISTS srv_approved_requires_approval();
DROP FUNCTION IF EXISTS srv_body_immutable();

DROP INDEX IF EXISTS idx_sra_version;
DROP INDEX IF EXISTS idx_srv_status;
DROP INDEX IF EXISTS idx_srv_recipe;
DROP INDEX IF EXISTS idx_shot_recipes_project;

ALTER TABLE IF EXISTS shot_recipes DROP CONSTRAINT IF EXISTS shot_recipes_current_version_fk;

DROP TABLE IF EXISTS shot_recipe_approvals;
DROP TABLE IF EXISTS shot_recipe_versions;
DROP TABLE IF EXISTS shot_recipes;

COMMIT;
