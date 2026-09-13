import { NextResponse } from "next/server";
import { attachImageToShot, ShotLinkError } from "@/lib/images/shotLink";

export const runtime = "nodejs";

/** POST {imageId, actor} — 합의 이미지를 쇼트에 붙인다. 쇼트는 다시 승인 대기가 된다. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as { imageId?: string; actor?: string };
  if (!body.imageId || !body.actor?.trim()) return NextResponse.json({ error: "imageId 와 붙이는 사람(actor)이 필요합니다." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...attachImageToShot(id, body.imageId, body.actor.trim()) });
  } catch (e) {
    if (e instanceof ShotLinkError) return NextResponse.json({ code: e.code, error: e.message }, { status: e.code.endsWith("NOT_FOUND") ? 404 : 400 });
    throw e;
  }
}
