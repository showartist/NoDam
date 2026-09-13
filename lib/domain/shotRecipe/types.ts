/**
 * Shot Recipe Canonical v1 — 37 fields.
 *
 * 저장 구조는 docs/phase8_canonical_a_mapping.md 를 따른다.
 *   lineage  shot_recipes            (recipeId, projectId, sceneId, shotId)
 *   version  shot_recipe_versions    (불변 본문 + status)
 *   link     shot_recipe_version_*   (관계형 ID 5종 — JSONB 에 묻지 않는다)
 *   event    shot_recipe_approvals   (approvedBy / approvedAt 은 여기서 계산)
 */

export type ShotRecipeStatus =
  | "draft"
  | "proposed"
  | "needs_review"
  | "approved"
  | "stale";

/** 승인 주체. AI 는 승인자가 될 수 없다. */
export type ApproverRole = "director" | "producer";
export type ApprovalDecision = "approved" | "revoked";

/** Reference 가 이 버전에서 맡는 역할. */
export type ReferenceRole = "first_frame" | "last_frame" | "general";

export type ProductionMethod = "practical" | "stock" | "ai_generation" | "hybrid";

/** 계보 헤드. 샷 하나당 하나. */
export type ShotRecipeLineage = {
  recipeId: string;
  projectId: string;
  sceneId: string;
  shotId: string;
  currentVersionId: string | null;
};

/** 관계형 ID 묶음. 각각 링크 테이블 한 개에 대응한다. */
export type ShotRecipeLinks = {
  subjectIds: string[];
  characterVisualVersionIds: string[];
  visualPrincipleVersionIds: string[];
  references: Array<{ referenceId: string; role: ReferenceRole }>;
  evidenceIds: string[];
};

/** 버전 본문. 한 번 저장되면 status 외에는 바뀌지 않는다. */
export type ShotRecipeVersionBody = {
  narrativePurpose: string | null;
  emotionalTarget: string | null;
  framing: string | null;
  shotSize: string | null;
  lensIntent: string | null;
  cameraPosition: string | null;
  cameraMovement: string | null;
  /** 무엇을 하는가. */
  subjectAction: string | null;
  /** 어떤 내적 상태·연기 방식으로 하는가. subjectAction 과 분리한다. */
  performanceDirection: string | null;
  environment: string | null;
  lighting: string | null;
  colorIntent: string | null;
  wardrobe: string | null;
  props: string | null;
  startState: string | null;
  endState: string | null;
  durationSeconds: number | null;
  motionSpeed: string | null;
  /** 서술형 목록. 관계형 ID 가 아니므로 배열로 둔다. */
  continuityInputs: string[];
  allowedElements: string[];
  prohibitedElements: string[];
  productionConstraints: string[];
};

export type ShotRecipeVersion = ShotRecipeVersionBody & {
  versionId: string;
  recipeId: string;
  version: number;
  status: ShotRecipeStatus;
  createdBy: string;
  createdAt: string;
  links: ShotRecipeLinks;
};

/** 승인 이벤트. append-only — 수정도 삭제도 하지 않는다. */
export type ShotRecipeApprovalEvent = {
  id: string;
  versionId: string;
  approverRole: ApproverRole;
  decision: ApprovalDecision;
  approvedBy: string;
  approvedAt: string;
  rationale: string | null;
  evidence: string[];
};

/**
 * approvedBy / approvedAt 은 본문 컬럼이 아니라 이벤트에서 계산되는 read model 이다.
 * 두 역할의 최신 결정이 모두 approved 일 때만 값을 갖는다.
 */
export type ApprovalReadModel = {
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  latestByRole: Record<ApproverRole, ShotRecipeApprovalEvent | null>;
  /** 승인이 안 된 이유. 화면에 그대로 보여줄 수 있다. */
  blockingReasons: string[];
};

/** 생성·실행 설정. Recipe 본문이 아니다 (Canonical B 이관분). */
export type ShotRecipeGenerationSpec = {
  versionId: string;
  productionMethod: ProductionMethod | null;
  splitGenerationRecommended: boolean;
  motionSegmentPlan: string | null;
  partialRegenerationZones: unknown[];
  soundCue: string | null;
  editPoint: string | null;
  postHandoffElements: unknown[];
  handoffManifestRef: string | null;
  aiAssistedElements: unknown[];
  humanAuthoredElements: unknown[];
};

export const SHOT_RECIPE_STATUSES: readonly ShotRecipeStatus[] = [
  "draft",
  "proposed",
  "needs_review",
  "approved",
  "stale",
];

export const APPROVER_ROLES: readonly ApproverRole[] = ["director", "producer"];

/** 빈 본문. 근거 없는 기본값을 만들지 않기 위해 전부 null / 빈 배열이다. */
export const EMPTY_VERSION_BODY: ShotRecipeVersionBody = {
  narrativePurpose: null,
  emotionalTarget: null,
  framing: null,
  shotSize: null,
  lensIntent: null,
  cameraPosition: null,
  cameraMovement: null,
  subjectAction: null,
  performanceDirection: null,
  environment: null,
  lighting: null,
  colorIntent: null,
  wardrobe: null,
  props: null,
  startState: null,
  endState: null,
  durationSeconds: null,
  motionSpeed: null,
  continuityInputs: [],
  allowedElements: [],
  prohibitedElements: [],
  productionConstraints: [],
};

export const EMPTY_LINKS: ShotRecipeLinks = {
  subjectIds: [],
  characterVisualVersionIds: [],
  visualPrincipleVersionIds: [],
  references: [],
  evidenceIds: [],
};
