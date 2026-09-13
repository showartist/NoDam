import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { changeDecisionBoard, getDecisionBoard, DecisionError } from "@/lib/meetingDecisions/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  if (error instanceof DecisionError) return NextResponse.json({error:error.message},{status:error.status});
  if (error instanceof SyntaxError) return NextResponse.json({error:"올바른 JSON 요청이 필요합니다."},{status:400});
  if (error instanceof ZodError) return NextResponse.json({error:error.issues.map(i=>i.message).join(" ")},{status:400});
  console.error("meeting decisions:",error);return NextResponse.json({error:"저장하지 못했습니다. 입력을 보존한 채 다시 시도해 주세요."},{status:500});
}
export async function GET(_request: Request, {params}:{params:Promise<{id:string}>}) {
  try {return NextResponse.json(getDecisionBoard((await params).id));} catch(e) {return failure(e);}
}
export async function POST(request: Request, {params}:{params:Promise<{id:string}>}) {
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return NextResponse.json({error:"같은 앱에서 요청해 주세요."},{status:403});
  try {
    const body=await request.json();
    if(!Number.isSafeInteger(body?.revision)||body.revision<0)return NextResponse.json({error:"현재 기록 버전이 필요합니다."},{status:400});
    return NextResponse.json(changeDecisionBoard((await params).id,body.revision,body.command));
  } catch(e) {return failure(e);}
}
