import { NextResponse } from "next/server";
import { updateShot } from "@/lib/store";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  try {
    const row = updateShot(id, { action: body.action, fields: body.fields });
    if (!row) return NextResponse.json({ error: "샷을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, shot: row });
  } catch (e) {
    // 이미지 미생성 샷의 최종 승인 거부 등 — 규칙 위반은 400 으로 명확히 알린다.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
