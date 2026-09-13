import { NextResponse } from "next/server";
import { updateItem } from "@/lib/store";

export const runtime = "nodejs";

const TABLES = { brief: "scene_brief_items", decisions: "decisions" } as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ table: string; id: string }> }) {
  const { table, id } = await ctx.params;
  const target = TABLES[table as keyof typeof TABLES];
  if (!target) return NextResponse.json({ error: "알 수 없는 대상입니다." }, { status: 400 });

  const body = await req.json();
  const row = updateItem(target, id, { userValue: body.userValue, action: body.action });
  if (!row) return NextResponse.json({ error: "항목을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, item: row });
}
