import {sameAppOrigin} from "@/lib/httpOrigin";
import {NextResponse} from "next/server";
import {issueParticipantAccess,revokeParticipantAccess} from "@/lib/meetingDecisions/access";
import {DecisionError} from "@/lib/meetingDecisions/store";
export const runtime="nodejs";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 if(!sameAppOrigin(req))return NextResponse.json({error:"같은 앱에서 요청해 주세요."},{status:403});
 try{const {id}=await params,b=await req.json();if(typeof b.participantId!=="string")return NextResponse.json({error:"참가자를 선택하세요."},{status:400});if(b.revoke){revokeParticipantAccess(id,b.participantId);return NextResponse.json({ok:true});}return NextResponse.json(issueParticipantAccess(id,b.participantId),{headers:{"cache-control":"no-store"}});}catch(e){return NextResponse.json({error:(e as Error).message},{status:e instanceof DecisionError?e.status:400});}
}
