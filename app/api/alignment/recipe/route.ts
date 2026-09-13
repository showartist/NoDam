import { NextResponse } from "next/server";
import { saveExplorationRecipe, saveConsolidatedRecipe } from "@/lib/domain/persistence/sqliteRepository";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.type === "exploration") {
      saveExplorationRecipe(body.recipe);
    } else if (body.type === "consolidated") {
      saveConsolidatedRecipe(body.recipe);
    }
    return NextResponse.json({ success: true, message: "Recipe persisted to SQLite" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
