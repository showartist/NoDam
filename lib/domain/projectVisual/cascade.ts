import type { CascadeImpact, CascadeInput } from "./contracts";

export function calculateCascadeImpact(input: CascadeInput): CascadeImpact[] {
  return input.targets.map((target) => {
    const impactResult = !target.legacyLinkAvailable
      ? "unknown" as const
      : !target.inExplicitScope
        ? "unaffected" as const
        : "affected" as const;

    if (impactResult !== "affected") {
      return {
        targetType: target.targetType,
        targetId: target.targetId,
        impactResult,
        targetNewStatus: null,
        reason: impactResult === "unknown"
          ? "명시적 legacy 링크가 없어 인간 검토가 필요합니다."
          : "명시적 변경 범위를 검토했으며 대상과 무관합니다.",
      };
    }

    if (input.changeType === "first_confirmation") {
      return {
        targetType: target.targetType,
        targetId: target.targetId,
        impactResult,
        targetNewStatus: null,
        reason: "최초 확정은 기준 링크만 기록하며 기존 대상 상태를 변경하지 않습니다.",
      };
    }

    if (target.targetType === "scene") {
      return {
        targetType: "scene",
        targetId: target.targetId,
        impactResult,
        targetNewStatus: "review_required",
        reason: "수정된 원칙 버전에 명시적으로 연결된 Scene입니다.",
      };
    }

    return {
      targetType: "shot",
      targetId: target.targetId,
      impactResult,
      targetNewStatus: target.shotStatus === "approved" ? "restale" : null,
      reason: target.shotStatus === "approved"
        ? "수정된 원칙 버전에 연결된 승인 Shot입니다."
        : "연결된 미승인 Shot이므로 상태를 유지합니다.",
    };
  });
}
