import type { DecisionQuestion, PrincipleApproval, ProjectVisualContractAdapter, VisualPrincipleStatus } from "./contracts";
import { canConfirmVisualPrinciple, statusAfterApprovalWithdrawal } from "./approvals";
import { calculateCascadeImpact } from "./cascade";
import { calculateCharacterVisualImpact } from "./characterImpact";
import { migrateLegacyPrincipleStatus, migrateLegacyShotStatus } from "./migrations";

export class DefaultProjectVisualAdapter implements ProjectVisualContractAdapter {
  calculateCascadeImpact = calculateCascadeImpact;
  calculateCharacterVisualImpact = calculateCharacterVisualImpact;
  canConfirmVisualPrinciple = canConfirmVisualPrinciple;
  migrateLegacyShotStatus = migrateLegacyShotStatus;
  migrateLegacyPrincipleStatus = migrateLegacyPrincipleStatus;

  decideQuestion(question: DecisionQuestion): VisualPrincipleStatus {
    return question.state === "decided" && question.decidedOptionId && question.decidedBy && question.decidedAt
      ? "candidate"
      : "needs_review";
  }

  withdrawApproval(currentStatus: VisualPrincipleStatus, approvals: PrincipleApproval[], approverId: string): VisualPrincipleStatus {
    return statusAfterApprovalWithdrawal(currentStatus, approvals, approverId);
  }
}

export const defaultProjectVisualAdapter = new DefaultProjectVisualAdapter();
