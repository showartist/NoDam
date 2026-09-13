/**
 * Shot Recipe 서비스 오류.
 *
 * DB 제약이 최종 무결성을 보장하고, 이 계층은 사람이 읽을 수 있는 도메인 오류를 만든다.
 * 기존 projectVisual 서비스와 같은 코드 체계를 쓴다.
 */
export type ShotRecipeErrorCode =
  | "DATABASE_NOT_CONFIGURED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "APPROVAL_INCOMPLETE"
  | "INVALID_STATE_TRANSITION"
  | "IMMUTABLE_VERSION"
  | "DELETE_RESTRICTED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

/**
 * HTTP 상태 매핑.
 *
 * 구분 기준
 *   400 요청 자체가 잘못됨 (형식·필수값)
 *   404 대상 없음
 *   409 리소스의 현재 상태와 충돌 (승인 부족·불변 위반·삭제 제한·중복)
 *   422 요청은 올바르나 지금 상태에서 처리할 수 없음 (상태 기계 위약)
 *
 * INVALID_STATE_TRANSITION 만 422 인 이유: `draft → approve` 는 요청이 잘못된 것도
 * (400) 대상이 없는 것도 (404) 아니고, 승인이 모자란 것도 아니다 (그건
 * APPROVAL_INCOMPLETE). "형식은 맞지만 지금 이 상태에서는 처리 불가"라는 뜻이므로
 * 422 가 정확하다. 409 로 두면 승인 부족과 구분이 되지 않는다.
 */
const STATUS: Record<ShotRecipeErrorCode, number> = {
  DATABASE_NOT_CONFIGURED: 503,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  APPROVAL_INCOMPLETE: 409,
  INVALID_STATE_TRANSITION: 422,
  IMMUTABLE_VERSION: 409,
  DELETE_RESTRICTED: 409,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export class ShotRecipeServiceError extends Error {
  readonly status: number;
  constructor(readonly code: ShotRecipeErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ShotRecipeServiceError";
    this.status = STATUS[code];
  }
}

/**
 * DB 오류를 도메인 오류로 옮긴다.
 * 트리거가 던지는 한국어 메시지를 그대로 살려 현장에서 읽히게 한다.
 */
export function toShotRecipeError(error: unknown): ShotRecipeServiceError {
  if (error instanceof ShotRecipeServiceError) return error;

  const e = error as { code?: string; constraint?: string; message?: string };
  const msg = e.message ?? "";

  // 트리거 메시지 (011_shot_recipe_a_triggers.sql)
  if (/본문은 불변입니다/.test(msg)) {
    return new ShotRecipeServiceError("IMMUTABLE_VERSION", msg);
  }
  if (/감독·제작의 최신 승인/.test(msg)) {
    return new ShotRecipeServiceError("APPROVAL_INCOMPLETE", msg);
  }
  if (/append-only/.test(msg)) {
    return new ShotRecipeServiceError("IMMUTABLE_VERSION", msg);
  }
  if (/Scene 과 다릅니다|Project 와 다릅니다|Scene 에 속해 있지 않습니다|다른 프로젝트의 캐릭터/.test(msg)) {
    return new ShotRecipeServiceError("VALIDATION_ERROR", msg);
  }

  if (e.code === "23505") {
    return new ShotRecipeServiceError("CONFLICT", "이미 존재하는 Shot Recipe 레코드입니다.");
  }
  if (e.code === "23503") {
    // RESTRICT 로 막힌 삭제와 존재하지 않는 참조를 구분한다.
    return /still referenced|violates foreign key constraint .*on table/.test(msg)
      ? new ShotRecipeServiceError("DELETE_RESTRICTED", "다른 기록이 참조 중이라 삭제할 수 없습니다.")
      : new ShotRecipeServiceError("NOT_FOUND", "참조 대상을 찾을 수 없습니다.");
  }
  if (e.code === "23514") {
    return new ShotRecipeServiceError("VALIDATION_ERROR", "값이 계약을 만족하지 않습니다.");
  }
  if (/DATABASE_URL/.test(msg)) {
    return new ShotRecipeServiceError("DATABASE_NOT_CONFIGURED", "영속 DB 연결이 필요합니다.");
  }

  return new ShotRecipeServiceError("INTERNAL_ERROR", "Shot Recipe 요청을 처리하지 못했습니다.");
}
