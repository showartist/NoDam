// Project Visual 쓰기 클라이언트.
//
// 원칙:
//   - 서버 응답 전에 성공을 표시하지 않는다 (optimistic 금지).
//   - 실패를 삼키지 않는다. API 오류 코드를 그대로 호출자에게 올린다.
//   - localStorage / 메모리 CRUD 로 대체하지 않는다.
//   - 쓰기 후 화면 상태는 workspace 를 다시 읽어서 갱신한다 (UI 로컬 추정 금지).
import type { WorkspaceApiError } from "./types";

export class MutationError extends Error {
  constructor(readonly payload: WorkspaceApiError, readonly status: number) {
    super(payload.message);
    this.name = "MutationError";
  }
}

const base = (projectId: string) => `/api/project-visual/projects/${encodeURIComponent(projectId)}`;

async function send<T>(url: string, method: "POST" | "PATCH", body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // 네트워크 자체가 실패한 경우도 성공으로 위장하지 않는다.
    throw new MutationError({ code: "NETWORK_ERROR", message: "서버에 연결하지 못했습니다." }, 0);
  }
  const parsed = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: WorkspaceApiError }
    | null;
  if (!response.ok || !parsed?.ok) {
    throw new MutationError(
      parsed?.error ?? { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." },
      response.status,
    );
  }
  return parsed.data as T;
}

/** Reference 신규 등록 */
export const createReference = (projectId: string, input: Record<string, unknown>) =>
  send(`${base(projectId)}/references`, "POST", input);

/** Reference 수정 — 반영 수준 변경 등 */
export const updateReference = (projectId: string, referenceId: string, input: Record<string, unknown>) =>
  send(`${base(projectId)}/references/${encodeURIComponent(referenceId)}`, "PATCH", input);

/** Reference ↔ Scene 명시적 링크 */
export const linkReferenceToScene = (projectId: string, referenceId: string, sceneId: string) =>
  send(`${base(projectId)}/references/${encodeURIComponent(referenceId)}`, "POST", {
    action: "link_scene",
    sceneId,
  });

/** 결정 질문 생성 */
export const createDecisionQuestion = (projectId: string, input: Record<string, unknown>) =>
  send(`${base(projectId)}/decision-questions`, "POST", input);

/** 결정 질문 상태 변경 (open → discussion 등) */
export const setQuestionState = (projectId: string, questionId: string, state: string) =>
  send(`${base(projectId)}/decision-questions/${encodeURIComponent(questionId)}`, "PATCH", {
    action: "set_state",
    state,
  });

/** 결정 질문 확정 — 결정자는 참여자 ID 로 지정한다 */
export const decideQuestion = (
  projectId: string,
  questionId: string,
  input: { decidedOption: string; decidedBy: string; candidate?: unknown },
) =>
  send(`${base(projectId)}/decision-questions/${encodeURIComponent(questionId)}`, "PATCH", {
    action: "decide",
    ...input,
  });

/** Visual Principle 생성 */
export const createPrinciple = (projectId: string, input: Record<string, unknown>) =>
  send(`${base(projectId)}/principles`, "POST", input);

/** 새 Principle Version 생성 — 기존 버전은 불변으로 남는다 */
export const createPrincipleVersion = (projectId: string, principleId: string, input: Record<string, unknown>) =>
  send(`${base(projectId)}/principles/${encodeURIComponent(principleId)}/versions`, "POST", input);

/** 감독 / 제작 승인 */
export const approveVersion = (
  projectId: string,
  principleId: string,
  input: { versionId: string; approverId: string; role: "director" | "producer"; evidenceUid?: string },
) => send(`${base(projectId)}/principles/${encodeURIComponent(principleId)}/approvals`, "POST", input);

/** 승인 철회 — 기존 승인 기록을 덮어쓰지 않고 withdrawn 이력으로 남긴다 */
export const withdrawApproval = (
  projectId: string,
  principleId: string,
  input: { versionId: string; approvalId: string; approverId: string; reason: string },
) =>
  send(`${base(projectId)}/principles/${encodeURIComponent(principleId)}/approvals`, "PATCH", {
    action: "withdraw",
    ...input,
  });

/** 확정 원칙 버전 수정 + cascade 실행. 영향 계산은 서버가 한다. */
export const runCascade = (projectId: string, principleId: string, update: Record<string, unknown>) =>
  send(`${base(projectId)}/principles/${encodeURIComponent(principleId)}/impacts`, "POST", {
    action: "update_confirmed",
    update,
  });

/** Character Visual Bible 생성 */
export const createCharacterVisual = (projectId: string, input: Record<string, unknown>) =>
  send(`${base(projectId)}/character-visuals`, "POST", input);
