import { NextResponse } from "next/server";
import { buildReport, reportToMarkdown, type ReportRole } from "@/lib/report";
import { ROLES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 역할별 회의 결과 문서. ?role=all|director|writer|producer&format=md|json */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const roleParam = url.searchParams.get("role") ?? "all";
  const role = (ROLES as readonly string[]).includes(roleParam) ? (roleParam as ReportRole) : "all";
  const format = url.searchParams.get("format") ?? "md";

  let report;
  try {
    report = buildReport(id, role);
  } catch (e) {
    // evidence 는 normalizeEvidence 가 이미 걸러내므로 여기까지 오면 다른 원인이다.
    // 원인과 무관하게 클라이언트에는 스택을 노출하지 않는다.
    console.error(`[report] buildReport 실패 meeting=${id} role=${role}:`, e);
    return NextResponse.json({ error: "보고서를 생성하지 못했습니다." }, { status: 500 });
  }
  if (!report) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });

  if (format === "json") return NextResponse.json(report);

  const md = reportToMarkdown(report);
  const slug = `${report.slugline.replace(/[^0-9A-Za-z가-힣]+/g, "_").slice(0, 40)}_${role}`;
  return new NextResponse(md, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(slug)}.md`,
    },
  });
}
