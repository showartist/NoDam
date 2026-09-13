import { NextResponse } from "next/server";
import { ingestChunk, LiveError, getEngine } from "@/lib/live/session";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST — 마이크 조각 하나(multipart: file, sessionId, offsetMs). 받자마자 큐에 넣고 202 로 답한다. */
export async function POST(req: Request, props: {params:Promise<{id:string}>}) {
  const {id}=await props.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const sessionId = String(form?.get("sessionId") ?? "");
  const offsetMs = Number(form?.get("offsetMs") ?? 0);
  if (!(file instanceof File) || !sessionId) return NextResponse.json({ error: "file 과 sessionId 가 필요합니다." }, { status: 400 });
  if(file.size>8*1024*1024)return NextResponse.json({error:"녹음 조각은 8MB 이하여야 합니다."},{status:413});
  const engine=getEngine(sessionId);
  if(!engine || engine.meetingId!==id)return NextResponse.json({error:"이 회의의 활성 녹음 세션을 찾을 수 없습니다."},{status:404});
  const ext = (file.name.split(".").pop() || file.type.split("/")[1]?.split(";")[0] || "webm").toLowerCase();
  try {
    void ingestChunk(sessionId, { bytes: Buffer.from(await file.arrayBuffer()), ext, offsetMs }).catch(err=>console.error("[live chunk]",(err as Error).message));
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (err) {
    if (err instanceof LiveError) return NextResponse.json({ code: err.code, error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 409 });
    throw err;
  }
}
