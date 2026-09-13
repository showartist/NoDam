import busboy from "busboy";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream, statSync } from "node:fs";
import path from "node:path";
import { MAX_BYTES, assertSupportedAudio, TranscriptionError } from "./index";

/** multipart를 디스크로 스트리밍한다. 업로드 전체의 ArrayBuffer/Buffer를 만들지 않는다. */
export async function streamAudioUpload(req: Request, dir: string) {
  if (!req.body) throw new Error("업로드 본문이 없습니다.");
  const parser = busboy({ headers: { "content-type": req.headers.get("content-type") ?? "" }, limits: { files: 1, fields: 0, fileSize: MAX_BYTES } });
  let fileName = "", file = "", invalid = false;
  const writes: Promise<void>[] = [];
  parser.on("file", (name, stream, info) => {
    if (name !== "file") { invalid = true; stream.resume(); return; }
    fileName = path.basename(info.filename);
    try { assertSupportedAudio(fileName, 1); } catch { invalid = true; stream.resume(); return; }
    file = path.join(dir, `source.${fileName.split(".").pop()!.toLowerCase()}`);
    stream.on("limit", () => { invalid = true; });
    // 오류는 즉시 관찰하되 parser 종료 후 전체 write도 기다린다.
    const write = pipeline(stream, createWriteStream(file, { flags: "wx" }));
    void write.catch(() => {}); writes.push(write);
  });
  parser.on("filesLimit", () => { invalid = true; });
  parser.on("fieldsLimit", () => { invalid = true; });
  try { await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), parser); }
  finally { await Promise.all(writes); }
  if (invalid || !file) throw new TranscriptionError("UNSUPPORTED_FORMAT", "지원 형식의 file 하나(최대 500MB)를 보내세요. 업로드가 잘렸거나 형식이 잘못되었습니다.");
  assertSupportedAudio(fileName, statSync(file).size);
  return { file, fileName };
}
