/**
 * Shot Recipe API 핸들러 (전송 계층 독립).
 *
 * Next 라우트 파일은 이 함수들을 감싸기만 한다. 여기에는 NextRequest/NextResponse 가
 * 없고 서비스와 평범한 값만 있다. 그래서 DB·HTTP 서버 없이 인메모리 저장소로
 * **상태 코드 매핑까지** 검증할 수 있다.
 *
 * 규칙
 *   - 도메인 오류는 ShotRecipeServiceError 의 status 를 그대로 쓴다. 여기서 새로 정하지 않는다.
 *   - 알 수 없는 오류를 200 으로 감추지 않는다.
 *   - 본문 파싱 실패는 500 이 아니라 400 이다.
 */
import { ShotRecipeServiceError, toShotRecipeError } from "../../services/shotRecipe/errors";
import type { ShotRecipeService } from "../../services/shotRecipe/shotRecipeService";
import type { ApproverRole } from "../../domain/shotRecipe/types";

export type ApiResult = {
  status: number;
  body:
    | { ok: true; data: unknown }
    | { ok: false; error: { code: string; message: string; details?: unknown } };
};

const ok = (data: unknown, status = 200): ApiResult => ({ status, body: { ok: true, data } });

export function fail(error: unknown): ApiResult {
  const e = toShotRecipeError(error);
  return {
    status: e.status,
    body: { ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
  };
}

async function run(work: () => Promise<unknown>, status = 200): Promise<ApiResult> {
  try {
    return ok(await work(), status);
  } catch (error) {
    return fail(error);
  }
}

/** 요청 본문이 JSON 객체인지 확인한다. 아니면 400. */
export function requireObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ShotRecipeServiceError("VALIDATION_ERROR", "요청 본문은 JSON 객체여야 합니다.");
  }
  return body as Record<string, unknown>;
}

function str(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new ShotRecipeServiceError("VALIDATION_ERROR", `${field} 가 필요합니다.`, { field });
  }
  return v.trim();
}

function role(v: unknown): ApproverRole {
  const s = str(v, "approverRole");
  if (s !== "director" && s !== "producer") {
    throw new ShotRecipeServiceError("VALIDATION_ERROR", "approverRole 은 director 또는 producer 여야 합니다.", {
      field: "approverRole",
    });
  }
  return s;
}

// ── 엔드포인트 ────────────────────────────────────────────────────────────

/** POST /api/shot-recipe — Recipe 계보 + v1(draft) 생성 */
export const createRecipe = (svc: ShotRecipeService, rawBody: unknown): Promise<ApiResult> =>
  run(async () => {
    const b = requireObject(rawBody);
    return svc.createRecipe({
      recipeId: typeof b.recipeId === "string" ? b.recipeId : undefined,
      projectId: str(b.projectId, "projectId"),
      sceneId: str(b.sceneId, "sceneId"),
      shotId: str(b.shotId, "shotId"),
      body: (b.body ?? {}) as never,
      links: (b.links ?? {}) as never,
      createdBy: str(b.createdBy, "createdBy"),
    });
  }, 201);

/** GET /api/shot-recipe/{recipeId} */
export const getRecipe = (svc: ShotRecipeService, recipeId: string): Promise<ApiResult> =>
  run(() => svc.getRecipe(recipeId));

/** GET /api/shot-recipe/{recipeId}/versions — 버전 이력 */
export const listVersions = (svc: ShotRecipeService, recipeId: string): Promise<ApiResult> =>
  run(async () => ({ recipeId, versions: await svc.listHistory(recipeId) }));

/** POST /api/shot-recipe/{recipeId}/versions — 새 버전 (본문 불변이므로 수정은 항상 이 경로) */
export const createVersion = (svc: ShotRecipeService, recipeId: string, rawBody: unknown): Promise<ApiResult> =>
  run(async () => {
    const b = requireObject(rawBody);
    return svc.createNewVersion({
      recipeId,
      changes: (b.changes ?? undefined) as never,
      links: (b.links ?? undefined) as never,
      createdBy: str(b.createdBy, "createdBy"),
    });
  }, 201);

/**
 * POST /api/shot-recipe/{recipeId}/transitions — 상태 전이
 * action: propose | request_review | approve
 */
export const transitionRecipe = (svc: ShotRecipeService, recipeId: string, rawBody: unknown): Promise<ApiResult> =>
  run(async () => {
    const b = requireObject(rawBody);
    const action = str(b.action, "action");
    if (action === "propose") return svc.propose(recipeId);
    if (action === "request_review") return svc.requestReview(recipeId);
    if (action === "approve") return svc.approve(recipeId);
    throw new ShotRecipeServiceError(
      "VALIDATION_ERROR",
      "action 은 propose, request_review, approve 중 하나여야 합니다.",
      { field: "action" },
    );
  });

/** POST /api/shot-recipe/{recipeId}/approvals — 역할별 승인 기록 (상태는 바뀌지 않음) */
export const recordApproval = (svc: ShotRecipeService, recipeId: string, rawBody: unknown): Promise<ApiResult> =>
  run(async () => {
    const b = requireObject(rawBody);
    return svc.recordApproval({
      recipeId,
      approverRole: role(b.approverRole),
      approvedBy: str(b.approvedBy, "approvedBy"),
      rationale: typeof b.rationale === "string" ? b.rationale : undefined,
      evidence: Array.isArray(b.evidence) ? (b.evidence as string[]) : undefined,
    });
  }, 201);

/** DELETE /api/shot-recipe/{recipeId}/approvals — 승인 철회 (append-only, 덮어쓰지 않음) */
export const revokeApproval = (svc: ShotRecipeService, recipeId: string, rawBody: unknown): Promise<ApiResult> =>
  run(async () => {
    const b = requireObject(rawBody);
    return svc.revokeApproval({
      recipeId,
      approverRole: role(b.approverRole),
      approvedBy: str(b.approvedBy, "approvedBy"),
      reason: str(b.reason, "reason"),
    });
  });

/** DELETE /api/shot-recipe/versions/{versionId} — 승인 이력 없는 draft 만 삭제 */
export const deleteDraftVersion = (svc: ShotRecipeService, versionId: string): Promise<ApiResult> =>
  run(async () => {
    await svc.deleteDraftVersion(versionId);
    return { versionId, deleted: true };
  });
