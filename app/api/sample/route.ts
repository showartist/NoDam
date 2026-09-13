import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const raw = await readFile(path.join(process.cwd(), "fixtures", "sample.json"), "utf8");
  return NextResponse.json(JSON.parse(raw));
}
