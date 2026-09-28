import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createIntake, IntakeError } from "@/lib/meetingIntake/store";

export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 150_000) return NextResponse.json({error:"입력이 너무 큽니다. 텍스트는 100,000자 이내로 입력해 주세요."},{status:413});
    const result = createIntake(JSON.parse(raw));
    return NextResponse.json(result, {status:result.reused?200:201});
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({error:"입력 형식을 확인해 주세요."},{status:400});
    if (error instanceof ZodError) return NextResponse.json({error:error.issues[0]?.message??"입력을 확인해 주세요."},{status:400});
    if (error instanceof IntakeError) return NextResponse.json({error:error.message},{status:error.status});
    console.error("Meeting intake save failed", error);
    return NextResponse.json({error:"저장하지 못했습니다. 입력을 유지한 채 다시 시도해 주세요."},{status:500});
  }
}
