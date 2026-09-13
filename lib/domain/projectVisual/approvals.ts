import type { PrincipleApproval, VisualPrincipleStatus } from "./contracts";

export function canConfirmVisualPrinciple(approvals: PrincipleApproval[]): boolean {
  const active = approvals.filter((approval) => approval.status === "active");
  const versions = new Set(active.map((approval) => approval.principleVersionId));
  if (versions.size !== 1) return false;
  return active.some((approval) => approval.role === "director")
    && active.some((approval) => approval.role === "producer");
}

export function statusAfterApprovalWithdrawal(
  currentStatus: VisualPrincipleStatus,
  approvals: PrincipleApproval[],
  approverId: string,
): VisualPrincipleStatus {
  const hasActiveApproval = approvals.some(
    (approval) => approval.approverId === approverId && approval.status === "active",
  );
  return currentStatus === "confirmed" && hasActiveApproval ? "needs_review" : currentStatus;
}
