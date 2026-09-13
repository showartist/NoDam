-- Phase 8A — Character Identity 롤백
BEGIN;

DROP TRIGGER IF EXISTS trg_srvs_same_project ON shot_recipe_version_subjects;
DROP FUNCTION IF EXISTS srvs_same_project();

ALTER TABLE IF EXISTS shot_recipe_version_subjects DROP CONSTRAINT IF EXISTS srvs_character_fk;

DROP INDEX IF EXISTS idx_characters_project;
DROP TABLE IF EXISTS characters;

COMMIT;
