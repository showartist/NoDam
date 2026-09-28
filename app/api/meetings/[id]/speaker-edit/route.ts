import {sameAppOrigin} from "@/lib/httpOrigin";
import {NextResponse} from "next/server";
import {ZodError} from "zod";
import {editSpeakers} from "@/lib/meetingIntake/edit";
import {IntakeError} from "@/lib/meetingIntake/store";
export const runtime="nodejs";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 if(!sameAppOrigin(req))return NextResponse.json({error:"다른 사이트에서의 수정 요청은 허용하지 않습니다."},{status:403});
 try{return NextResponse.json(editSpeakers((await params).id,await req.json()));}catch(e){return NextResponse.json({error:e instanceof ZodError?"화자명과 선택한 발언을 확인해 주세요.":(e as Error).message},{status:e instanceof IntakeError?e.status:400});}
}
