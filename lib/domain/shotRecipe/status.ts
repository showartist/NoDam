/**
 * Shot Recipe 상태 전이 규칙 (순수 함수).
 *
 *   draft ─propose→ proposed ─requestReview→ needs_review
 *                      └────────approve───────┴─→ approved
 *   approved ─revoke→ needs_review
 *   any(≠stale) ─markStale→ stale        (상위 원칙·Bible 변경 시)
 *   stale ─reviseIntoNewVersion→ (새 버전 draft)
 *
 * approved 로 가는 길은 승인 이벤트가 결정한다 (approval.ts).
 * 여기서는 "상태 기계상 허용되는가"만 판정하고, 승인 충족 여부는 별도로 확인한다.
 */
import { canMarkApproved } from "./approval";
import type { ShotRecipeApprovalEvent, ShotRecipeStatus } from "./types";

export type StatusTransition =
  | "propose"
  | "request_review"
  | "approve"
  | "revoke"
  | "mark_stale";

const ALLOWED: Record<StatusTransition, { from: ShotRecipeStatus[]; to: ShotRecipeStatus }> = {
  propose:        { from: ["draft", "needs_review"],              to: "proposed" },
  request_review: { from: ["draft", "proposed", "approved"],      to: "needs_review" },
  approve:        { from: ["proposed", "needs_review"],           to: "approved" },
  revoke:         { from: ["approved"],                            to: "needs_review" },
  mark_stale:     { from: ["draft", "proposed", "needs_review", "approved"], to: "stale" },
};

export type TransitionResult =
  | { ok: true; next: ShotRecipeStatus }
  | { ok: false; reason: string };

/**
 * 상태 전이 판정.
 * approve 는 감독·제작 최신 승인이 모두 있어야 하므로 이벤트를 함께 받는다.
 */
export function transition(
  current: ShotRecipeStatus,
  action: StatusTransition,
  events: readonly ShotRecipeApprovalEvent[] = [],
): TransitionResult {
  const rule = ALLOWED[action];
  if (!rule) return { ok: false, reason: `알 수 없는 전이입니다: ${action}` };

  if (!rule.from.includes(current)) {
    return { ok: false, reason: `${current} 상태에서는 ${action} 할 수 없습니다.` };
  }

  if (action === "approve" && !canMarkApproved(events)) {
    return { ok: false, reason: "감독·제작의 최신 승인이 모두 있어야 approved 가 됩니다." };
  }

  return { ok: true, next: rule.to };
}

/**
 * stale 인 Recipe 는 생성 대상으로 쓸 수 없다.
 * 상위 Visual Principle / Character Bible 이 바뀌면 재검토가 필요하기 때문이다.
 */
export function isUsableForGeneration(status: ShotRecipeStatus): boolean {
  return status === "approved";
}

export function generationBlockReason(status: ShotRecipeStatus): string | null {
  if (status === "approved") return null;
  if (status === "stale") return "상위 원칙이 바뀌어 재검토가 필요합니다. 새 버전을 만드십시오.";
  return `승인되지 않은 Recipe 입니다 (현재 ${status}). 생성에 사용할 수 없습니다.`;
}
