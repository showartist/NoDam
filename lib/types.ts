// SceneSync v0.6 — 영화 기획·프리프로덕션 2계층 워크벤치 타입

export const DECISION_STATES = [
  "proposed",
  "candidate",
  "confirmed",
  "rejected",
  "superseded",
  "uncertain",
] as const;
export type DecisionState = (typeof DECISION_STATES)[number];

export const AI_ALLOWED_STATES: DecisionState[] = [
  "proposed",
  "candidate",
  "rejected",
  "superseded",
  "uncertain",
];

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "근거 충분",
  medium: "검토 권장",
  low: "추가 확인 필요",
};

export const STATE_LABEL: Record<DecisionState, string> = {
  proposed: "제안",
  candidate: "확정 후보",
  confirmed: "확정",
  rejected: "미채택",
  superseded: "대체됨",
  uncertain: "불확실",
};

export type DetectionSignal =
  | "explicit_opposition"
  | "term_divergence"
  | "creative_production_clash"
  | "intent_coverage_gap"
  | "deferred_commitment";

export const DETECTION_SIGNAL_LABEL: Record<DetectionSignal, string> = {
  explicit_opposition: "연출 방향 충돌",
  term_divergence: "같은 말, 다른 해석",
  creative_production_clash: "연출·제작 충돌",
  intent_coverage_gap: "필수 쇼트 누락",
  deferred_commitment: "결정 미룸",
};

export type IssueScope =
  | "project"
  | "character"
  | "story"
  | "scene"
  | "shot"
  | "production";

export const ISSUE_SCOPE_LABEL: Record<IssueScope, string> = {
  project: "작품 전체 (Project)",
  character: "인물 서사 (Character)",
  story: "스토리 구조 (Story)",
  scene: "장면 연출 (Scene)",
  shot: "쇼트 촬영 (Shot)",
  production: "제작 조건 (Production)",
};

export type ProjectBible = {
  working_title: string;
  english_title: string;
  format: string;
  genre: string;
  one_liner: string;
  logline: string;
  short_synopsis: string;
  theme: string;
  dramatic_question: string;
  tone: string;
  target_audience: string;
  ending_direction: string;
};

export type CharacterItem = {
  id: string;
  name: string;
  story_role: string;
  external_goal: string;
  internal_need: string;
  wound: string;
  fear: string;
  secret: string;
  contradiction: string;
  arc: string;
  relationship_summary: string;
  decision_state: DecisionState;
};

export type VisualReferenceCategory =
  | "world_tone"
  | "character_direction"
  | "key_locations"
  | "signature_images"
  | "negative_references";

export type VisualReferenceItem = {
  id: string;
  title: string;
  category: VisualReferenceCategory;
  image_url: string;
  uploaded_by: string;
  level: "core" | "partial" | "reference" | "exclude";
  include_elements: string[];
  exclude_elements: string[];
  role_interpretations: Record<string, string>;
  decision_state: DecisionState;
  evidence: string[];
};

export type VisualPrincipleItem = {
  id: string;
  title: string;
  principle: string;
  rationale: string;
  applies_to: string[];
  references: string[];
  evidence: string[];
  status: "approved" | "review_required";
};

export type SceneIssueType =
  | "interpretation_gap"
  | "missing_information"
  | "constraint_conflict"
  | "historical_conflict"
  | "option_conflict"
  | "decision_state_mismatch";

export const SCENE_ISSUE_TYPE_LABEL: Record<SceneIssueType, string> = {
  interpretation_gap: "동상이몽 (해석 차이)",
  missing_information: "필수 정보 누락",
  constraint_conflict: "제약 조건 충돌",
  historical_conflict: "이전 결정과의 충돌",
  option_conflict: "선택지 충돌",
  decision_state_mismatch: "결정 상태 불일치",
};

export const SCENE_ISSUE_LABEL = SCENE_ISSUE_TYPE_LABEL;

export type SceneIssueSeverity = "critical" | "high" | "medium" | "low";

export type SceneIssue = {
  id: string;
  issue_id: string;
  scope?: IssueScope;
  type: SceneIssueType;
  detection_signal?: DetectionSignal;
  detection_reason?: string;
  subject: string;
  question: string;
  positions: Array<{ role: string; role_label: string; position: string; evidence_uids: string[] }>;
  evidence: string[];
  severity: SceneIssueSeverity;
  status: "open" | "resolved" | "dismissed";
  blocks_roles?: Exclude<Role, "all">[];
};

export type Role = "all" | "director" | "writer" | "producer" | "cinematographer" | "art_director";

export const ROLES: Role[] = ["all", "director", "writer", "producer", "cinematographer", "art_director"];

export const ROLE_LABEL: Record<Role, string> = {
  all: "전체 보기",
  director: "감독",
  writer: "작가",
  producer: "제작PD",
  cinematographer: "촬영감독",
  art_director: "미술감독",
};

export const ROLE_FOCUS_NOTE: Record<Role, string> = {
  all: "전체 부서 통합 워크벤치입니다.",
  director: "연출 방향, 연기 톤, 시각 잔상 중심 보기",
  writer: "대사, 서사 목표, 드라마틱 질문 중심 보기",
  producer: "예산, 셋업 시간, 안전 검측, 블로킹 리스크 중심 보기",
  cinematographer: "렌즈 선택, 무빙, 조명 톤, Intent Coverage 중심 보기",
  art_director: "소품 준비, 공간 톤, 비주얼 레퍼런스, 연속성 중심 보기",
};

export const SCENE_BRIEF_FIELDS = [
  "SCENE_NUMBER",
  "INT_EXT",
  "LOCATION",
  "TIME_OF_DAY",
  "CHARACTERS",
  "SCENE_FUNCTION",
  "DRAMATIC_INTENT",
  "CHARACTER_GOALS",
  "CONFLICT_POINT",
  "KEY_ACTION",
  "EMOTIONAL_ARC",
  "KEY_OBJECT",
  "ATMOSPHERE_MOOD",
  "LAST_IMAGE",
  "SHOOTING_STYLE",
  "SPACE_CONCEPT",
  "TIME_CONSTRAINTS",
  "SAFETY_CONSTRAINTS",
  "BUDGET_CONSTRAINTS",
  "TECHNICAL_CHECKLIST",
  "CONTINUITY_CHECK",
  "ACTOR_DIRECTIONS",
  "OPEN_QUESTIONS",
] as const;
export type SceneBriefField = (typeof SCENE_BRIEF_FIELDS)[number];

export const SLUGLINE_FIELDS: SceneBriefField[] = [
  "SCENE_NUMBER",
  "INT_EXT",
  "LOCATION",
  "TIME_OF_DAY",
];

export const SCENE_BRIEF_LABEL: Record<SceneBriefField, string> = {
  SCENE_NUMBER: "장면 번호",
  INT_EXT: "실내/실외 (INT/EXT)",
  LOCATION: "장소명",
  TIME_OF_DAY: "시간대 (DAY/NIGHT/DAWN)",
  CHARACTERS: "등장인물 목록",
  SCENE_FUNCTION: "장면의 극적 기능 (Scene Function)",
  DRAMATIC_INTENT: "연출 의도 (Dramatic Intent)",
  CHARACTER_GOALS: "인물별 목표 (Character Goals)",
  CONFLICT_POINT: "주요 갈등 지점 (Conflict Point)",
  KEY_ACTION: "핵심 물리 행동 (Key Action)",
  EMOTIONAL_ARC: "감정선 변화 (Emotional Arc)",
  KEY_OBJECT: "핵심 상징 오브제 (Key Object)",
  ATMOSPHERE_MOOD: "분위기와 톤 (Atmosphere & Mood)",
  LAST_IMAGE: "마지막 잔상 시각 이미지 (Last Image)",
  SHOOTING_STYLE: "촬영 무빙·렌즈 톤",
  SPACE_CONCEPT: "공간 미장센 콘셉트",
  TIME_CONSTRAINTS: "촬영 시간 제약",
  SAFETY_CONSTRAINTS: "안전 검측 제약",
  BUDGET_CONSTRAINTS: "예산 제약",
  TECHNICAL_CHECKLIST: "기술 점검 항목",
  CONTINUITY_CHECK: "연속성 확인 항목",
  ACTOR_DIRECTIONS: "배우 연기 디렉션",
  OPEN_QUESTIONS: "의사결정 필요 질문",
};

export const FIELD_DISPLAY_LABEL = SCENE_BRIEF_LABEL;

export const ROLE_BRIEF_FIELDS: Record<Exclude<Role, "all">, SceneBriefField[]> = {
  director: [
    "DRAMATIC_INTENT",
    "EMOTIONAL_ARC",
    "KEY_ACTION",
    "LAST_IMAGE",
    "ACTOR_DIRECTIONS",
    "OPEN_QUESTIONS",
  ],
  writer: [
    "SCENE_FUNCTION",
    "CHARACTER_GOALS",
    "CONFLICT_POINT",
    "KEY_OBJECT",
    "OPEN_QUESTIONS",
  ],
  producer: [
    "TIME_CONSTRAINTS",
    "SAFETY_CONSTRAINTS",
    "BUDGET_CONSTRAINTS",
    "TECHNICAL_CHECKLIST",
    "OPEN_QUESTIONS",
  ],
  cinematographer: [
    "SHOOTING_STYLE",
    "LAST_IMAGE",
    "ATMOSPHERE_MOOD",
    "TECHNICAL_CHECKLIST",
    "OPEN_QUESTIONS",
  ],
  art_director: [
    "SPACE_CONCEPT",
    "KEY_OBJECT",
    "ATMOSPHERE_MOOD",
    "CONTINUITY_CHECK",
    "OPEN_QUESTIONS",
  ],
};

export const INTENT_TYPES = ["key_action", "key_object", "last_image", "safety"] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export type SceneIntent = {
  id: string;
  type: IntentType;
  text: string;
  source_field: SceneBriefField;
  evidence: string[];
  version: number;
  decision_state?: DecisionState;
};

export type CoverageLink = {
  id: string;
  meeting_id: string;
  shot_id: string;
  intent_id: string;
  // 실제 값 도메인이 둘이다 — claimCoverage 로 만든 행은 Role(부서), 시드 fixture 행은
  // CoverageFunction(설정/강조/회수 등) — coverageRoleDisplayLabel 참고.
  role: Role | CoverageFunction;
  coverage_claimed_by: string;
  coverage_verification_state: CoverageVerificationState;
  intent_version: number;
  updated_at: string;
};

export type ProductionImpact = {
  id: string;
  meeting_id: string;
  asset_type: string;
  target_id: string;
  label: string;
  status: string;
  action: string;
  updated_at: string;
};

export const INTENT_TYPE_LABEL: Record<IntentType, string> = {
  key_action: "핵심 물리 행동",
  key_object: "핵심 상징 오브제",
  last_image: "마지막 잔상 시각 이미지",
  safety: "안전 점검 필수 항목",
};

export const INTENT_LABEL = INTENT_TYPE_LABEL;

export type ExtractedItem = {
  content: string;
  decision_state: DecisionState;
  evidence: string[];
  confidence: Confidence;
  note?: string;
};

export type ExtractedDecision = ExtractedItem & { id: string };

export type ExtractedUnresolved = {
  id: string;
  subject: string;
  evidence: string[];
  question: string;
  blocks_roles?: Exclude<Role, "all">[];
};

export type ExtractedIntent = {
  type: IntentType;
  text: string;
  source_field: SceneBriefField;
  evidence: string[];
};

export type Extracted = {
  scene_brief: Record<SceneBriefField, ExtractedItem[]>;
  decisions: ExtractedDecision[];
  unresolved: ExtractedUnresolved[];
  intents: ExtractedIntent[];
};

export const SHOT_COUNT_RECOMMENDED_MAX = 12;
export const REPRESENTATIVE_SHOT_COUNT = 6;
export const ISSUE_SUBJECT_SHOT_COVERAGE = "shot_coverage";

export type ShotStatus = "proposed" | "approved" | "restale";

export const SHOT_STATUS_LABEL: Record<ShotStatus, string> = {
  proposed: "제안",
  approved: "승인됨",
  restale: "재검토 필요 (stale)",
};

/**
 * 이미지 생성 여부. shot_decision_state(구도 제안)와 별개 축이다.
 * 구도는 제안됐지만 이미지는 아직 없는 상태가 정상적으로 존재한다.
 * not_generated 인 샷은 final_approval_state 가 unavailable 이어야 한다.
 */
export type ImageState = "not_generated" | "generating" | "generated";

export const IMAGE_STATE_LABEL: Record<ImageState, string> = {
  not_generated: "스토리보드 이미지 미생성",
  generating: "이미지 생성 중",
  generated: "이미지 생성됨",
};

export type ReferenceKind = "visual" | "film" | "audio" | "text";

export const REFERENCE_KIND_LABEL: Record<ReferenceKind, string> = {
  visual: "시각 레퍼런스",
  film: "영화 톤앤매너",
  audio: "음향 사운드",
  text: "텍스트 및 대본",
};

export const REFERENCE_APPLICATIONS = [
  "lighting",
  "camera_move",
  "space_color",
  "actor_tone",
  "sound_design",
] as const;
export type ReferenceApplication = (typeof REFERENCE_APPLICATIONS)[number];

export const REFERENCE_APPLICATION_LABEL: Record<ReferenceApplication, string> = {
  lighting: "조명 라이팅",
  camera_move: "카메라 무빙",
  space_color: "공간 미장센 색감",
  actor_tone: "배우 연기 톤",
  sound_design: "사운드 디자인",
};

export type CoverageRole = Role;
// intents.ts 가 실제로 쓰는 값 전체(proposed 기본값, verified/stale/needs_review 전이 포함).
// approved/pending 은 과거 명칭이 남은 것 — 실사용 코드가 남아 있어 유지한다.
export type CoverageVerificationState =
  | "approved"
  | "pending"
  | "rejected"
  | "proposed"
  | "verified"
  | "stale"
  | "needs_review";
export type CoverageStatus = "covered" | "partial" | "missing";

export const COVERAGE_ROLE_LABEL = ROLE_LABEL;

/**
 * shot_coverage.role 은 값 도메인이 둘로 나뉜다.
 *   - claimCoverage 로 실시간 생성된 행: 부서 역할 (director/cinematographer/art_director) — CoverageRole
 *   - 시드 fixture 로 들어온 행: 이 샷이 의도를 어떤 방식으로 담당하는지 (primary/setup/emphasis/supporting)
 * 두 도메인을 같은 라벨 테이블로 조회하면 안 된다 — coverageRoleDisplayLabel 로 구분해서 조회한다.
 */
// payoff(회수)는 key_object 설정→강조→회수 3단계 추적(evaluateCoverage, lib/intents.ts)이 쓴다 —
// 지금 시드 fixture 에는 setup/emphasis 주장만 있고 payoff 주장은 없다(한 씬 분량이라 해당 오브제의
// 회수가 다른 씬에서 일어날 수 있음). 값이 아직 안 보이는 것과 타입이 없는 것은 다른 문제다.
export type CoverageFunction = "primary" | "setup" | "emphasis" | "payoff" | "supporting";
export const COVERAGE_FUNCTION_LABEL: Record<CoverageFunction, string> = {
  primary: "핵심 커버리지",
  setup: "선행 설정",
  emphasis: "강조",
  payoff: "회수",
  supporting: "보조 커버리지",
};

/** 표시 전용 라벨 조회 — 두 도메인 모두 아니면 미분류로 표시하고 서버에 경고를 남긴다. */
export function coverageRoleDisplayLabel(role: string): string {
  if (Object.prototype.hasOwnProperty.call(COVERAGE_ROLE_LABEL, role)) {
    return COVERAGE_ROLE_LABEL[role as Role];
  }
  if (Object.prototype.hasOwnProperty.call(COVERAGE_FUNCTION_LABEL, role)) {
    return COVERAGE_FUNCTION_LABEL[role as CoverageFunction];
  }
  console.warn(`[coverage] 알 수 없는 shot_coverage.role 값: "${role}"`);
  return "미분류 커버리지";
}

export const COVERAGE_STATE_LABEL: Record<CoverageVerificationState, string> = {
  approved: "승인됨",
  pending: "검토 필요",
  rejected: "미채택",
  proposed: "제안됨",
  verified: "확인됨",
  stale: "재검토 필요 (변경됨)",
  needs_review: "순서 변경 · 재검토 필요",
};

/** 표시 전용 라벨 조회 — 알려지지 않은 상태 값도 undefined 로 새지 않게 방어한다. */
export function coverageStateDisplayLabel(state: string): string {
  if (Object.prototype.hasOwnProperty.call(COVERAGE_STATE_LABEL, state)) {
    return COVERAGE_STATE_LABEL[state as CoverageVerificationState];
  }
  console.warn(`[coverage] 알 수 없는 shot_coverage.coverage_verification_state 값: "${state}"`);
  return "상태 미확인";
}
export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  covered: "커버 완료",
  partial: "부분 커버",
  missing: "쇼트 누락",
};

export type CoverageActionKey = "add_shot" | "modify_shot" | "accept_risk";
export const COVERAGE_ACTIONS: CoverageActionKey[] = ["add_shot", "modify_shot", "accept_risk"];

export const COVERAGE_ACTION_LABEL: Record<CoverageActionKey, string> = {
  add_shot: "전담 Insert Shot 추가",
  modify_shot: "기존 샷 사양 수정",
  accept_risk: "제작 리스크 수용",
};

export const SCENE_ISSUE_ACTION = {
  resolve: "해결 및 상태 변경",
  dismiss: "무시 (수용)",
};

export const IMPACT_ACTION_LABEL = {
  restale: "재검토 필요 전환",
  approved: "승인 상태 유지",
};

export const IMPACT_STATUS_LABEL = {
  pending: "영향 검토 대기",
  applied: "영향 반영 완료",
};

export const SHOT_PROPOSAL_FIELDS = [
  "shot_size",
  "lens",
  "camera_height",
  "camera_move",
  "character_action",
  "dialogue_sound",
  "duration",
  "purpose",
  "production_check",
] as const;

// Scene Brief 추출 스키마. OpenRouter json_schema strict 로 강제한다.
// strict 모드 제약: 모든 필드 required, additionalProperties false, 선택 값은 null.
// decision_state 에 confirmed 가 없다 — AI 는 확정을 출력할 수 없다(제품 원칙 1).
const EXTRACTION_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["content", "decision_state", "evidence", "confidence", "note"],
  properties: {
    content: { type: "string" },
    decision_state: { type: "string", enum: AI_ALLOWED_STATES },
    evidence: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: CONFIDENCES },
    note: { type: ["string", "null"] },
  },
} as const;

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scene_brief", "decisions", "unresolved", "intents"],
  properties: {
    scene_brief: {
      type: "object",
      additionalProperties: false,
      required: [...SCENE_BRIEF_FIELDS],
      properties: Object.fromEntries(SCENE_BRIEF_FIELDS.map((f) => [f, { type: "array", items: EXTRACTION_ITEM }])),
    },
    decisions: {
      type: "array",
      items: {
        ...EXTRACTION_ITEM,
        required: ["id", ...EXTRACTION_ITEM.required],
        properties: { id: { type: "string" }, ...EXTRACTION_ITEM.properties },
      },
    },
    unresolved: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "subject", "evidence", "question", "blocks_roles"],
        properties: {
          id: { type: "string" },
          subject: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          question: { type: "string" },
          blocks_roles: { type: "array", items: { type: "string", enum: ["director", "writer", "producer"] } },
        },
      },
    },
    intents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "source_field", "evidence"],
        properties: {
          type: { type: "string", enum: INTENT_TYPES },
          text: { type: "string" },
          source_field: { type: "string", enum: SCENE_BRIEF_FIELDS },
          evidence: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
