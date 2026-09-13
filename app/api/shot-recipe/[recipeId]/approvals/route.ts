import { recordApproval, revokeApproval } from "@/lib/api/shotRecipe/handlers";
import { getShotRecipeService } from "@/lib/services/shotRecipe/runtime";
import { guardService, readJson, toResponse } from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — 역할별 승인 기록. 상태는 바뀌지 않는다(두 역할 충족 후 transitions 로 승인). */
export async function POST(request: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await recordApproval(g.service, (await ctx.params).recipeId, await readJson(request)));
}

/** DELETE — 승인 철회. 기존 기록을 덮어쓰지 않고 revoked 이벤트를 덧붙인다. */
export async function DELETE(request: Request, ctx: { params: Promise<{ recipeId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await revokeApproval(g.service, (await ctx.params).recipeId, await readJson(request)));
}
