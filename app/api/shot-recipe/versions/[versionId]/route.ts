import { deleteDraftVersion } from "@/lib/api/shotRecipe/handlers";
import { getShotRecipeService } from "@/lib/services/shotRecipe/runtime";
import { guardService, toResponse } from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE — 승인 이력 없는 draft 만 삭제. 그 외는 사유와 함께 거부한다. */
export async function DELETE(_: Request, ctx: { params: Promise<{ versionId: string }> }) {
  const g = guardService(getShotRecipeService);
  if ("response" in g) return g.response;
  return toResponse(await deleteDraftVersion(g.service, (await ctx.params).versionId));
}
