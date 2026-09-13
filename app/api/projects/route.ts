import { NextResponse } from "next/server";
import { createProject } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json();
  if (!body?.title?.trim()) return NextResponse.json({ error: "프로젝트명이 필요합니다." }, { status: 400 });
  if (!body?.transcript?.trim()) return NextResponse.json({ error: "회의 전사가 필요합니다." }, { status: 400 });

  const result = createProject({
    title: body.title.trim(),
    domain: body.domain === "video" ? "video" : "performance",
    oneLine: (body.oneLine ?? "").trim(),
    participants: Array.isArray(body.participants) ? body.participants : [],
    transcript: body.transcript,
  });

  if (result.utteranceCount === 0) {
    return NextResponse.json(
      { error: "전사에서 발언을 하나도 찾지 못했습니다. '이름: 대사' 형식인지 확인하세요." },
      { status: 400 },
    );
  }
  return NextResponse.json(result);
}
