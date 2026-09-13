import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { MEDIA_BY_EXT } from "@/lib/images/imageBytes";
import { resolveStoredPath } from "@/lib/images/paths";
import { getImage } from "@/lib/images/storage";

export const runtime = "nodejs";

/** GET — 생성 이미지 파일. completed 가 아니거나 파일이 없으면 404 (다른 이미지로 대신하지 않는다). */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const row = getImage(id);
  if (!row) return NextResponse.json({ error: "이미지가 없습니다." }, { status: 404 });
  if (row.status !== "completed" || !row.filePath) {
    return NextResponse.json({ error: `이미지가 없습니다 (상태: ${row.status}).`, status: row.status, detail: row.error }, { status: 404 });
  }
  const abs = resolveStoredPath(row.filePath);
  if (!existsSync(abs)) return NextResponse.json({ error: "이미지 파일이 디스크에 없습니다." }, { status: 404 });

  const ext = path.extname(abs).slice(1).toLowerCase();
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": MEDIA_BY_EXT[ext] ?? "application/octet-stream",
      "content-length": String(statSync(abs).size),
      // 같은 id 의 바이트는 바뀌지 않는다
      "cache-control": "private, max-age=31536000, immutable",
    },
  });
}
