import { createVersion, listVersions } from "@/lib/api/shotRecipe/handlers";
import { getShotRecipeService } from "@/lib/services/shotRecipe/runtime";
import { guardService, readJson, toResponse } from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — 버전 이력 */
export async function GET(_: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await listVersions(g.service, (await ctx.params).recipeId));
}

/** POST — 새 버전. 본문은 불변이므로 내용 변경은 언제나 이 경로다. */
export async function POST(request: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await createVersion(g.service, (await ctx.params).recipeId, await readJson(request)));
}
