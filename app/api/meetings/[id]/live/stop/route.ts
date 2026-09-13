import { NextResponse } from "next/server";
import { LiveError, stopSession, getEngine } from "@/lib/live/session";
import { cancelReplay } from "@/lib/live/replay";

export const runtime = "nodejs";
export const maxDuration = 600;

/** POST — 정지. 남은 조각·발언을 마저 처리하고 run 을 닫는다. */
export async function POST(req: Request, props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ error: "sessionId 가 필요합니다." }, { status: 400 });
  const engine=getEngine(body.sessionId);
  if(!engine||engine.meetingId!==id)return NextResponse.json({error:"이 회의의 활성 세션을 찾을 수 없습니다."},{status:404});
  cancelReplay(body.sessionId);
  try {
    const r = await stopSession(body.sessionId);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof LiveError) return NextResponse.json({ code: err.code, error: err.message }, { status: err.code === "PENDING_CHUNKS" ? 409 : 404 });
    throw err;
  }
}
