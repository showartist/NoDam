import {segmentBase} from "@/lib/live/segments";
import { FacilitatorConfig } from "@/lib/facilitator/policy";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { LiveError, startSession } from "@/lib/live/session";
import { startReplay } from "@/lib/live/replay";
import { resolveReplaySource } from "@/lib/live/sources";

export const runtime = "nodejs";

/** POST — 라이브 세션 시작. mode=mic 은 브라우저가 조각을 보내고, mode=replay 는 서버가 녹음 파일을 흘려 보낸다. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const body = (await req.json().catch(() => ({}))) as { mode?: "mic" | "replay"; source?: string; speed?: number; windowSize?: number; facilitator?: unknown; continueMeeting?: boolean };
  if(!db().prepare("SELECT id FROM meetings WHERE id=?").get(id))return NextResponse.json({error:"회의를 찾을 수 없습니다."},{status:404});
  const facilitator=body.facilitator ? FacilitatorConfig.safeParse(body.facilitator) : null;
  if(facilitator && !facilitator.success)return NextResponse.json({error:"회의 목적(10자 이상)과 관찰 주기(3·5·10분)를 확인하세요."},{status:400});
  const mode = body.mode === "replay" ? "replay" : "mic";
  let file: string | null = null;
  if (mode === "replay") {
    file = body.source ? resolveReplaySource(body.source) : null;
    if (!file || !existsSync(file)) return NextResponse.json({ error: "재생할 녹음 파일을 찾을 수 없습니다." }, { status: 400 });
  }
  try {
    const e = startSession(id, mode, { continueMeeting:body.continueMeeting===true, source: body.source, speed: body.speed, windowSize: body.windowSize, facilitator: facilitator?.success ? facilitator.data : undefined });
    if (mode === "replay" && file) startReplay(e.sessionId, file, { speed: body.speed });
    return NextResponse.json({ sessionId: e.sessionId, runId: e.runId, mode, baseOffsetMs:segmentBase(e.sessionId) });
  } catch (err) {
    if (err instanceof LiveError) return NextResponse.json({ code: err.code, error: err.message }, { status: 409 });
    throw err;
  }
}
