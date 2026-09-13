/**
 * 이미지 파이프라인 공통 오류.
 *
 * 외부 API 실패를 빈 성공으로 숨기지 않는다 (아키텍처 경계 원칙 5).
 * 화면과 API 가 원인을 구분할 수 있도록 code 를 붙여 던진다.
 *
 * 이 파일은 순수 모듈이다. 브라우저 번들에서 import 해도 된다.
 */

export type ImageErrorCode =
  | "NOT_CONFIGURED" // OPENROUTER_API_KEY 없음
  | "PROVIDER_ERROR" // 공급자 오류(4xx·5xx·응답 형식 오류). 공급자 메시지를 그대로 싣는다
  | "TIMEOUT" // 우리 쪽 제한 시간 초과 또는 공급자 408
  | "QUOTA_EXCEEDED" // 회의·결정 단위 생성 상한, OpenRouter 크레딧 부족(402)·요청 한도(429)
  | "NO_IMAGE" // 200 인데 이미지가 없음
  | "INVALID_INPUT" // 요청 값 검증 실패
  | "NOT_FOUND"; // 안건·레퍼런스·이미지가 없음

export class ImageGenError extends Error {
  readonly code: ImageErrorCode;
  /** 공급자 HTTP 상태. 공급자까지 가지 않았으면 null */
  readonly status: number | null;
  readonly detail: Record<string, unknown> | null;
  /** 실패로 기록된 generated_images 행. 행을 만들기 전에 실패했으면 null */
  imageId: string | null = null;

  constructor(
    code: ImageErrorCode,
    message: string,
    opts: { status?: number | null; detail?: Record<string, unknown> | null } = {},
  ) {
    super(message);
    this.name = "ImageGenError";
    this.code = code;
    this.status = opts.status ?? null;
    this.detail = opts.detail ?? null;
  }
}

/** API 라우트가 돌려줄 HTTP 상태. */
export function httpStatusFor(code: ImageErrorCode): number {
  switch (code) {
    case "NOT_CONFIGURED":
      return 503;
    case "QUOTA_EXCEEDED":
      return 429;
    case "TIMEOUT":
      return 504;
    case "INVALID_INPUT":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "NO_IMAGE":
    case "PROVIDER_ERROR":
    default:
      return 502;
  }
}
