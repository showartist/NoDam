import {NextResponse} from "next/server";
import {shareState,updateShare} from "@/lib/sharing/liveShare";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return NextResponse.json(shareState((await params).id));}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:"같은 앱에서 요청해 주세요."},{status:403});
 const body=await request.json().catch(()=>null);if(!body||!["start","sync","stop"].includes(body.action))return NextResponse.json({error:"잘못된 공유 요청"},{status:400});
 try{return NextResponse.json(await updateShare((await params).id,body.action));}catch(e){return NextResponse.json({error:(e as Error).message},{status:503});}
}
