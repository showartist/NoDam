import type { PrincipleApproval, ShotStatus, VisualPrincipleStatus } from "./contracts";
import { canConfirmVisualPrinciple } from "./approvals";

export function migrateLegacyShotStatus(status: "draft" | ShotStatus): ShotStatus {
  return status === "draft" ? "proposed" : status;
}

export function migrateLegacyPrincipleStatus(input: {
  status: "approved" | "review_required";
  approvedBy: string | null;
  approvedAt: string | null;
  approvals?: PrincipleApproval[];
}): VisualPrincipleStatus {
  if (input.status === "review_required") return "needs_review";
  return input.approvals && canConfirmVisualPrinciple(input.approvals)
    ? "confirmed"
    : "needs_review";
}
