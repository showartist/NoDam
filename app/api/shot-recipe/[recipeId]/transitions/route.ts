import { transitionRecipe } from "@/lib/api/shotRecipe/handlers";
import { getShotRecipeService } from "@/lib/services/shotRecipe/runtime";
import { guardService, readJson, toResponse } from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — 상태 전이 (propose | request_review | approve) */
export async function POST(request: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await transitionRecipe(g.service, (await ctx.params).recipeId, await readJson(request)));
}
