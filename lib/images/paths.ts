/**
 * 이미지·레퍼런스 파일 위치. 서버 전용.
 *
 * 기본은 <cwd>/.data (git 제외). SCENENOTE_DATA_DIR 로 바꿀 수 있다(테스트·평가 스크립트).
 * DB 에는 cwd 기준 상대 경로를 남긴다. 폴더를 옮겨도 행이 깨지지 않게 하기 위해서다.
 * cwd 밖(임시 폴더 등)이면 절대 경로를 남긴다.
 */
import path from "node:path";

export function dataDir(): string {
  const d = process.env.SCENENOTE_DATA_DIR?.trim();
  if (d) return path.resolve(d);
  return process.env.VERCEL ? path.join("/tmp", "scenenote-data") : path.join(process.cwd(), ".data");
}

export const imagesDir = () => path.join(dataDir(), "images");
export const referencesDir = () => path.join(dataDir(), "references");

export function toStoredPath(abs: string): string {
  const rel = path.relative(process.cwd(), abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : abs;
}

export function resolveStoredPath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}
