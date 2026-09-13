/**
 * Shot Recipe 라우트 공용 어댑터.
 * 라우트 파일은 얇게 유지하고, 실제 로직은 lib/api/shotRecipe/handlers.ts 가 갖는다.
 */
import { NextResponse } from "next/server";
import type { ApiResult } from "@/lib/api/shotRecipe/handlers";
import { fail } from "@/lib/api/shotRecipe/handlers";

export const toResponse = (r: ApiResult) => NextResponse.json(r.body, { status: r.status });

/** JSON 본문 파싱. 깨진 본문은 500 이 아니라 400 으로 돌려준다. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** 서비스 획득 실패(DATABASE_NOT_CONFIGURED 등)도 정상 오류 응답으로 만든다. */
export function guardService<T>(get: () => T): { service: T } | { response: NextResponse } {
  try {
    return { service: get() };
  } catch (error) {
    return { response: toResponse(fail(error)) };
  }
}
