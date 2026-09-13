/**
 * 승인 판정 — 역할별 "최신" 이벤트만 본다.
 *
 * 과거에 approved 가 한 번이라도 있었는지(EXISTS)로 판정하지 않는다.
 * 철회 이후 과거 승인을 근거로 approved 를 허용하면 안 되기 때문이다.
 *
 * 이 규칙은 DB 트리거(011_shot_recipe_a_triggers.sql T2)와 동일하다.
 * DB 는 최종 무결성을, 이 함수는 명확한 도메인 오류를 담당한다.
 */
import {
  APPROVER_ROLES,
  type ApprovalReadModel,
  type ApproverRole,
  type ShotRecipeApprovalEvent,
} from "./types";

const ROLE_LABEL: Record<ApproverRole, string> = {
  director: "감독",
  producer: "제작",
};

/**
 * 한 역할의 최신 이벤트. 시각이 같으면 id 로 결정론적으로 끊는다
 * (DB 의 `ORDER BY approved_at DESC, id DESC` 와 동일한 순서).
 */
export function latestEventForRole(
  events: readonly ShotRecipeApprovalEvent[],
  role: ApproverRole,
): ShotRecipeApprovalEvent | null {
  const ofRole = events.filter((e) => e.approverRole === role);
  if (ofRole.length === 0) return null;
  return ofRole.reduce((best, e) => {
    if (e.approvedAt > best.approvedAt) return e;
    if (e.approvedAt < best.approvedAt) return best;
    return e.id > best.id ? e : best;
  });
}

/**
 * 승인 read model. 두 역할의 최신 결정이 모두 approved 일 때만 approved 다.
 * approvedAt 은 두 승인 중 더 늦은 시각을 대표값으로 삼는다.
 */
export function computeApproval(events: readonly ShotRecipeApprovalEvent[]): ApprovalReadModel {
  const latestByRole = {
    director: latestEventForRole(events, "director"),
    producer: latestEventForRole(events, "producer"),
  } as Record<ApproverRole, ShotRecipeApprovalEvent | null>;

  const blockingReasons: string[] = [];
  for (const role of APPROVER_ROLES) {
    const latest = latestByRole[role];
    if (!latest) blockingReasons.push(`${ROLE_LABEL[role]} 승인 없음`);
    else if (latest.decision === "revoked") blockingReasons.push(`${ROLE_LABEL[role]} 승인 철회됨`);
  }

  if (blockingReasons.length > 0) {
    return { approved: false, approvedBy: null, approvedAt: null, latestByRole, blockingReasons };
  }

  const director = latestByRole.director!;
  const producer = latestByRole.producer!;
  const last = director.approvedAt >= producer.approvedAt ? director : producer;

  return {
    approved: true,
    approvedBy: last.approvedBy,
    approvedAt: last.approvedAt,
    latestByRole,
    blockingReasons: [],
  };
}

/** 이 버전을 approved 로 올릴 수 있는가. */
export function canMarkApproved(events: readonly ShotRecipeApprovalEvent[]): boolean {
  return computeApproval(events).approved;
}

/**
 * 철회 가능 여부. 그 역할의 최신 결정이 approved 일 때만 철회할 수 있다.
 * 이미 철회된 것을 또 철회하지 않는다.
 */
export function canRevoke(
  events: readonly ShotRecipeApprovalEvent[],
  role: ApproverRole,
): { ok: boolean; reason?: string } {
  const latest = latestEventForRole(events, role);
  if (!latest) return { ok: false, reason: `${ROLE_LABEL[role]} 승인 기록이 없어 철회할 수 없습니다.` };
  if (latest.decision === "revoked") return { ok: false, reason: `${ROLE_LABEL[role]} 승인은 이미 철회되었습니다.` };
  return { ok: true };
}
