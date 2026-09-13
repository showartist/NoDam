/**
 * Project Visual Workspace domain-contract draft.
 *
 * This file intentionally contains types only. Persistence and mutations remain
 * unimplemented until the contract-first tests are wired to a real adapter.
 */

export type VisualPrincipleStatus =
  | "candidate"
  | "needs_review"
  | "confirmed"
  | "stale";

export type SceneReviewStatus = "current" | "review_required";
export type SceneIssueStatus = "open" | "resolved" | "dismissed";
export type ShotStatus = "proposed" | "approved" | "restale";
export type ReferenceImageState = "not_uploaded" | "uploaded";
export type GeneratedImageState = "not_generated" | "generating" | "generated";
export type DecisionQuestionState =
  | "open"
  | "discussion"
  | "decision_proposed"
  | "decided"
  | "reopened";

export type CascadeChangeType = "first_confirmation" | "version_update";
export type CascadeTargetType = "scene" | "shot";
export type CascadeImpactResult = "affected" | "unaffected" | "unknown";
export type CascadeTargetNewStatus = "review_required" | "restale" | null;

export type PrincipleVersionSnapshot = {
  id: string;
  principleId: string;
  version: number;
  status: VisualPrincipleStatus;
  contentHash: string;
};

export type PrincipleSceneLink = {
  principleVersionId: string;
  sceneId: string;
};

export type PrincipleShotLink = {
  principleVersionId: string;
  shotId: string;
};

export type CascadeSceneTarget = {
  targetType: "scene";
  targetId: string;
  reviewStatus: SceneReviewStatus;
  inExplicitScope: boolean;
  legacyLinkAvailable: boolean;
};

export type CascadeShotTarget = {
  targetType: "shot";
  targetId: string;
  shotStatus: ShotStatus;
  generatedImageState: GeneratedImageState;
  inExplicitScope: boolean;
  legacyLinkAvailable: boolean;
};

export type CascadeInput = {
  changeType: CascadeChangeType;
  beforeVersion: PrincipleVersionSnapshot | null;
  afterVersion: PrincipleVersionSnapshot;
  principleSceneLinks: PrincipleSceneLink[];
  principleShotLinks: PrincipleShotLink[];
  targets: Array<CascadeSceneTarget | CascadeShotTarget>;
};

export type CascadeImpact = {
  targetType: CascadeTargetType;
  targetId: string;
  impactResult: CascadeImpactResult;
  targetNewStatus: CascadeTargetNewStatus;
  reason: string;
};

export type PrincipleApproval = {
  principleVersionId: string;
  role: "director" | "producer";
  approverId: string;
  approvedAt: string;
  status: "active" | "withdrawn";
};

export type DecisionQuestion = {
  id: string;
  state: DecisionQuestionState;
  decidedOptionId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

export type CharacterVisualChangeInput = {
  characterId: string;
  linkedSceneIds: string[];
  candidateSceneIds: string[];
};

/** Adapter to be implemented only after the contract suite is accepted. */
export interface ProjectVisualContractAdapter {
  calculateCascadeImpact(input: CascadeInput): CascadeImpact[];
  decideQuestion(question: DecisionQuestion): VisualPrincipleStatus;
  canConfirmVisualPrinciple(approvals: PrincipleApproval[]): boolean;
  withdrawApproval(
    currentStatus: VisualPrincipleStatus,
    approvals: PrincipleApproval[],
    approverId: string,
  ): VisualPrincipleStatus;
  migrateLegacyShotStatus(status: "draft" | ShotStatus): ShotStatus;
  migrateLegacyPrincipleStatus(input: {
    status: "approved" | "review_required";
    approvedBy: string | null;
    approvedAt: string | null;
    approvals?: PrincipleApproval[];
  }): VisualPrincipleStatus;
  calculateCharacterVisualImpact(input: CharacterVisualChangeInput): CascadeImpact[];
}
