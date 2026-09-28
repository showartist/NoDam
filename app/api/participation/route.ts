import {NextResponse} from "next/server";
import {ZodError} from "zod";
import {participantView,participantCommand} from "@/lib/meetingDecisions/access";
import {DecisionError} from "@/lib/meetingDecisions/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const token=(req:Request)=>req.headers.get("authorization")?.replace(/^Bearer /,"")??"";
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"cache-control":"no-store","referrer-policy":"no-referrer"}});
function error(e:unknown){return json({error:e instanceof DecisionError?e.message:"입력을 확인해 주세요."},e instanceof DecisionError?e.status:e instanceof ZodError?400:500);}
export async function GET(req:Request){try{return json(participantView(token(req)));}catch(e){return error(e);}}
export async function POST(req:Request){try{const text=await req.text();if(text.length>16000)return json({error:"입력이 너무 깁니다."},413);const b=JSON.parse(text);if(!Number.isSafeInteger(b.revision)||b.revision<0)return json({error:"기록 버전을 확인하세요."},400);return json(participantCommand(token(req),b.revision,b.command));}catch(e){return error(e);}}
