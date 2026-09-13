import { createRecipe } from "@/lib/api/shotRecipe/handlers";
import { getShotRecipeService } from "@/lib/services/shotRecipe/runtime";
import { guardService, readJson, toResponse } from "./http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/shot-recipe — Recipe 계보 + v1(draft) 생성 */
export async function POST(request: Request) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await createRecipe(g.service, await readJson(request)));
}
