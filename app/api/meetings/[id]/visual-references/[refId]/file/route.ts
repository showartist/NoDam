import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { listReferences } from "@/lib/images/references";

export const runtime = "nodejs";

/** GET — 회의에 올린 레퍼런스 이미지 파일. .data/references 밖의 경로는 내보내지 않는다. */
export async function GET(_req: Request, props: { params: Promise<{ id: string; refId: string }> }) {
  const { id, refId } = await props.params;
  const ref = listReferences(id).find((r) => r.id === refId);
  const root = path.join(process.cwd(), ".data", "references");
  if (!ref?.filePath || !path.resolve(ref.filePath).startsWith(root) || !existsSync(ref.filePath)) {
    return new Response("not found", { status: 404 });
  }
  const ext = path.extname(ref.filePath).toLowerCase();
  const type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return new Response(readFileSync(ref.filePath), { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
