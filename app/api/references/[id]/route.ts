import { NextResponse } from "next/server";
import { updateReference } from "@/lib/store";
import { REFERENCE_APPLICATIONS, type ReferenceApplication } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const application = body.application as ReferenceApplication;
  if (!REFERENCE_APPLICATIONS.includes(application)) {
    return NextResponse.json({ error: "알 수 없는 반영 상태입니다." }, { status: 400 });
  }
  const row = updateReference(id, application);
  if (!row) return NextResponse.json({ error: "레퍼런스를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, reference: row });
}
