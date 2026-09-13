import {NextResponse} from "next/server";
import {resumeSession,LiveError} from "@/lib/live/session";
export const runtime="nodejs";
export async function POST(req:Request,props:{params:Promise<{id:string}>}){
 const {id}=await props.params;const body=await req.json().catch(()=>({}));
 if(typeof body.sessionId!=="string")return NextResponse.json({error:"세션이 필요합니다."},{status:400});
 try{const e=resumeSession(id,body.sessionId);return NextResponse.json({sessionId:e.sessionId});}
 catch(e){return NextResponse.json({error:(e as Error).message},{status:e instanceof LiveError?409:500});}
}
