/**
 * 재생 모드에 쓸 녹음 파일 목록. fixtures/eval/audio/<이름>/meeting.(m4a|wav) 와 .data/recordings/*.
 * 경로를 그대로 받지 않고 이름으로만 고르게 해서, 요청으로 임의 파일을 읽지 못하게 한다.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOTS = [path.join(process.cwd(), "fixtures", "eval", "audio"), path.join(process.cwd(), ".data", "recordings")];

export function listReplaySources(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root, { withFileTypes: true })) {
      if (d.isDirectory()) {
        for (const f of ["meeting.m4a", "meeting.wav"]) {
          const p = path.join(root, d.name, f);
          if (existsSync(p)) {
            out.push({ name: d.name, file: p });
            break;
          }
        }
      } else if (/\.(m4a|wav|mp3|webm)$/i.test(d.name)) {
        out.push({ name: d.name.replace(/\.[^.]+$/, ""), file: path.join(root, d.name) });
      }
    }
  }
  return out;
}

export function resolveReplaySource(name: string): string | null {
  return listReplaySources().find((s) => s.name === name)?.file ?? null;
}
