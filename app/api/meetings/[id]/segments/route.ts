import {NextResponse} from "next/server";
import {meetingSegments,segmentSnapshot} from "@/lib/live/segments";
export const runtime="nodejs";
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params,sessionId=new URL(req.url).searchParams.get("session");if(!sessionId)return NextResponse.json(meetingSegments(id));const saved=segmentSnapshot(id,sessionId);if(!saved?.snapshot_json)return NextResponse.json({error:"저장된 구간이 없습니다."},{status:404});return new Response(saved.snapshot_json,{headers:{"content-type":"application/json; charset=utf-8","content-disposition":"attachment; filename=meeting-segment.json","cache-control":"no-store"}});}
