/**
 * Shot Recipe 서비스 런타임 배선.
 *
 * DATABASE_URL 이 가리키는 DB 에만 붙는다. Preview·로컬 격리 DB 를 쓰면 그쪽으로,
 * 없으면 503 을 낸다.
 *
 * ⚠️ 미설정 시 인메모리·fixture 로 조용히 대체하지 않는다. 그렇게 하면 저장된 것처럼
 * 보이지만 실제로는 아무것도 남지 않는 상태가 되고, 사용자는 그 사실을 알 수 없다.
 * projectVisual 런타임과 같은 태도다.
 */
import { createProjectVisualDatabase, type QueryExecutor } from "../../repositories/projectVisual/db";
import { ShotRecipeRepository } from "../../repositories/shotRecipe/shotRecipeRepository";
import { ShotRecipeServiceError } from "./errors";
import { ShotRecipeService, type ConsistencyLookup } from "./shotRecipeService";

let service: ShotRecipeService | null = null;

/** project/scene/shot/character 일관성 확인용 최소 조회. */
function createLookup(db: QueryExecutor): ConsistencyLookup {
  return {
    async getShot(shotId) {
      const rows = await db.query<{ sceneId: string | null }>(
        'SELECT scene_id "sceneId" FROM shots WHERE id=$1',
        [shotId],
      );
      return rows[0] ?? null;
    },
    async getScene(sceneId) {
      const rows = await db.query<{ projectId: string }>(
        'SELECT project_id "projectId" FROM scenes WHERE id=$1',
        [sceneId],
      );
      return rows[0] ?? null;
    },
    async getCharacterProjects(characterIds) {
      if (!characterIds.length) return {};
      const rows = await db.query<{ characterId: string; projectId: string }>(
        'SELECT DISTINCT character_id "characterId", project_id "projectId"' +
          " FROM character_visual_bibles WHERE character_id = ANY($1)",
        [characterIds],
      );
      const out: Record<string, string | null> = {};
      for (const id of characterIds) out[id] = null;
      for (const r of rows) out[r.characterId] = r.projectId;
      return out;
    },
  };
}

export function getShotRecipeService(): ShotRecipeService {
  if (service) return service;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new ShotRecipeServiceError(
      "DATABASE_NOT_CONFIGURED",
      "Shot Recipe 영속 DB 가 설정되지 않았습니다 (DATABASE_URL).",
    );
  }
  const db = createProjectVisualDatabase(url);
  service = new ShotRecipeService(new ShotRecipeRepository(db), createLookup(db));
  return service;
}
