import {finishRun} from "@/lib/alignment/store";
import {db} from "@/lib/db";
import { NextResponse } from "next/server";
import { LiveError, stopSession, getEngine, resumeSession } from "@/lib/live/session";
import { cancelReplay } from "@/lib/live/replay";

export const runtime = "nodejs";
export const maxDuration = 600;

/** POST — 정지. 남은 조각·발언을 마저 처리하고 run 을 닫는다. */
export async function POST(req: Request, props:{params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ error: "sessionId 가 필요합니다." }, { status: 400 });
  const saved=db().prepare("SELECT l.status,r.status run_status FROM live_sessions l JOIN alignment_v2_runs r ON r.id=l.run_id WHERE l.id=? AND l.meeting_id=?").get(body.sessionId,id) as {status:string;run_status:string}|undefined;
  if(saved?.status==="stopped"&&saved.run_status!=="failed")return NextResponse.json({ok:true,status:"stopped"});
  let engine=getEngine(body.sessionId);
  if(!engine){try{engine=resumeSession(id,body.sessionId,true);}catch{return NextResponse.json({error:"종료할 세션을 복구하지 못했습니다. 저장된 녹음을 확인해 주세요."},{status:409});}}
  if(!engine||engine.meetingId!==id)return NextResponse.json({error:"이 회의의 활성 세션을 찾을 수 없습니다."},{status:404});
  cancelReplay(body.sessionId);
  try {
    const r = await stopSession(body.sessionId);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof LiveError) return NextResponse.json({ code: err.code, error: err.message }, { status: err.code === "PENDING_CHUNKS" ? 409 : 404 });
    finishRun(engine.runId,{status:"failed",error:(err as Error).message});
    engine.stopping=false;
    engine.queue=engine.queue.catch(()=>{});
    db().prepare("UPDATE live_sessions SET status='recording',error=? WHERE id=?").run((err as Error).message,body.sessionId);
    return NextResponse.json({error:`녹음은 종료했습니다. ${(err as Error).message}`},{status:502});
  }
}
