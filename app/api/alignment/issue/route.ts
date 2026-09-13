import { NextResponse } from "next/server";
import { saveAlignmentIssue, getAlignmentIssues } from "@/lib/domain/persistence/sqliteRepository";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const issue = await req.json();
    saveAlignmentIssue(issue);
    return NextResponse.json({ success: true, message: "Alignment issue persisted to SQLite" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const meetingId = searchParams.get("meetingId") || "m_01";
  try {
    const issues = getAlignmentIssues(meetingId);
    return NextResponse.json({ success: true, issues });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
