import { NextResponse } from "next/server";
import { saveResolvedDecision, saveProductionImageRecipe } from "@/lib/domain/persistence/sqliteRepository";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body.decision) {
      saveResolvedDecision(body.decision);
    }
    if (body.productionRecipe) {
      saveProductionImageRecipe(body.productionRecipe);
    }
    return NextResponse.json({ success: true, message: "Resolution & Production Recipe persisted to SQLite" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
