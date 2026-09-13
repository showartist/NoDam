import { NextResponse } from "next/server";
import { DEMO_MEETING_ID, ensureSeed, reseed } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 데모 회의를 초기 상태로 되돌린다. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const meetingId = String(body.meetingId || DEMO_MEETING_ID);
  const created = body.force === false ? ensureSeed(meetingId) : reseed(meetingId);
  return NextResponse.json({ ok: true, meetingId, created });
}
