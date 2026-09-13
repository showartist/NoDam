import { NextResponse } from "next/server";
import { listReplaySources } from "@/lib/live/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ sources: listReplaySources().map((s) => ({ name: s.name })) });
}
