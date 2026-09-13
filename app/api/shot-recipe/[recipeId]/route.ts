import { getRecipe } from "@/lib/api/shotRecipe/handlers";
import { getShotRecipeService } from "@/lib/services/shotRecipe/runtime";
import { guardService, toResponse } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/shot-recipe/{recipeId} — 현재 버전·승인 상태·생성 가능 여부 */
export async function GET(_: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await getRecipe(g.service, (await ctx.params).recipeId));
}
