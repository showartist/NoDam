/**
 * 해석 차이 오브젝트 v2 (scenenote.alignment/2).
 *
 * 다시 짚기·관점 비교·합의 화면과 이미지 생성이 공통으로 읽는 정본이다.
 * 두 벌의 스키마를 둔다.
 *
 *   LlmAnalysisOutput  — LLM 이 내는 모양. OpenRouter json_schema(strict) 로 강제한다.
 *                        화자는 전사에 붙인 짧은 라벨(S1, S2 …)로만 가리키고, 이름은 쓰지 않는다.
 *   AlignmentIssueV2   — 검사를 통과한 뒤 저장·표시하는 모양. 화자 이름·역할은 DB 매핑에서 채운다.
 *
 * 규칙
 *   - 발언 원문은 오브젝트에 넣지 않는다. 발언 번호(U-ID)로만 가리킨다. (제품 원칙 2)
 *   - AI 는 state 로 resolved 를 쓸 수 없다. resolved 는 사람 승인으로만 생긴다. (제품 원칙 1)
 *   - 말하지 않은 해석 슬롯은 비워 둔다. 추측으로 채우지 않는다.
 */
import { z } from "zod";

export const SCHEMA_VERSION = "scenenote.alignment/2" as const;

/** exploration_recipes_v2 컬럼·ParticipantExplorationRecipe 필드와 같은 이름. */
export const SLOT_KEYS = [
  "composition",
  "subjectPresence",
  "subjectPlacement",
  "environment",
  "lighting",
  "colorIntent",
  "wardrobe",
  "props",
  "subjectAction",
  "performanceDirection",
  "requiredElements",
  "prohibitedElements",
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export const SLOT_LABEL: Record<SlotKey, string> = {
  composition: "구도",
  subjectPresence: "인물 유무",
  subjectPlacement: "인물 배치",
  environment: "공간",
  lighting: "조명",
  colorIntent: "색",
  wardrobe: "의상",
  props: "소품",
  subjectAction: "인물 행동",
  performanceDirection: "연기 방향",
  requiredElements: "필수 요소",
  prohibitedElements: "금지 요소",
};

/** 제품 원칙 9번 표의 유형. 화면 배지와 할 일이 이 값에 묶여 있다. */
export const ISSUE_TYPES = [
  "interpretation_gap",
  "competing_alternatives",
  "decision_state_mismatch",
  "constraint_conflict",
  "past_decision_conflict",
  "missing_information",
] as const;
export type IssueTypeV2 = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABEL: Record<IssueTypeV2, { label: string; todo: string }> = {
  interpretation_gap: { label: "해석 차이", todo: "의미를 확인한다" },
  competing_alternatives: { label: "대안 경쟁", todo: "선택 기준을 정한다" },
  decision_state_mismatch: { label: "결정 상태 불일치", todo: "승인 여부를 확인한다" },
  constraint_conflict: { label: "제약 충돌", todo: "조건을 만족하는 대안을 찾는다" },
  past_decision_conflict: { label: "과거 결정 충돌", todo: "변경 또는 복원을 결정한다" },
  missing_information: { label: "실행 정보 누락", todo: "필요한 값을 채운다" },
};

/**
 * 유형별로 서로 다른 화자가 몇 명 이상 있어야 안건이 성립하는가.
 * 해석 차이·대안 경쟁·제약 충돌은 두 사람 사이의 일이다. 한 사람의 정정은 차이가 아니다.
 */
export const MIN_DISTINCT_SPEAKERS: Record<IssueTypeV2, number> = {
  interpretation_gap: 2,
  competing_alternatives: 2,
  constraint_conflict: 2,
  decision_state_mismatch: 1,
  past_decision_conflict: 1,
  missing_information: 1,
};

/** AI 가 쓸 수 있는 상태. resolved 는 없다. */
export const AI_STATES = ["open", "conditional", "agreed_candidate"] as const;
export const ISSUE_STATES = [...AI_STATES, "resolved", "dismissed"] as const;
export type IssueStateV2 = (typeof ISSUE_STATES)[number];

export const ISSUE_STATE_LABEL: Record<IssueStateV2, string> = {
  open: "미결",
  conditional: "조건부 합의",
  agreed_candidate: "확정 후보",
  resolved: "감독 승인",
  dismissed: "제외",
};

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type SeverityV2 = (typeof SEVERITIES)[number];

// ── LLM 출력 스키마 ─────────────────────────────────────────────────────────
// strict 모드 제약에 맞춘다: 모든 필드 required, additionalProperties false,
// 선택 값은 null 로 표현한다. 슬롯은 12개 필드 대신 {slot,value} 배열로 받아
// 말하지 않은 슬롯이 아예 나오지 않게 한다.

export const LlmSlotValue = z.object({
  slot: z.enum(SLOT_KEYS),
  value: z.string().describe("그 사람이 이 항목에 대해 말한 값. 짧은 명사구. 말하지 않았으면 이 항목을 넣지 않는다"),
});

export const LlmPosition = z.object({
  speaker: z.string().describe("전사에 붙은 화자 라벨(S1, S2 …). 모르면 '?'"),
  meaning: z.string().describe("이 사람이 뜻한 것. 발언에 있는 내용만"),
  quote: z.string().describe("근거 발언 중 하나에서 그대로 옮긴 구절(8~40자). 바꿔 쓰지 않는다"),
  evidence: z.array(z.string()).describe("이 사람의 입장을 보여 주는 발언 번호. 이 사람이 한 발언이 하나 이상 있어야 한다"),
  slots: z.array(LlmSlotValue),
});

export const LlmCondition = z.object({
  text: z.string(),
  evidence: z.array(z.string()),
});

export const LlmRoleBrief = z.object({
  role: z.string().describe("역할 이름(감독, 촬영감독, 미술감독, 작가, 제작PD 등)"),
  text: z.string().describe("이 안건이 그 역할의 작업에서 무엇을 바꾸는지 한 문장"),
});

export const LlmIssue = z.object({
  key: z.string().describe("안건을 가리키는 짧은 영문 slug. 창 사이에서 같은 안건이면 같은 key"),
  type: z.enum(ISSUE_TYPES),
  decision: z.string().describe("무엇에 대한 결정인가"),
  concept: z.string().describe("서로 다르게 쓰인 표현. 해당 없으면 빈 문자열"),
  state: z.enum(AI_STATES),
  condition: LlmCondition.nullable().describe("조건부 합의일 때 남은 조건. 아니면 null"),
  positions: z.array(LlmPosition),
  question: z.string().describe("사람이 확인할 질문 한 문장. 판정하지 말고 묻는다"),
  why_it_matters: z.string(),
  severity: z.enum(SEVERITIES),
  role_briefs: z.array(LlmRoleBrief),
});

export const LlmAgreement = z.object({
  topic: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
});

export const LlmAnalysisOutput = z.object({
  issues: z.array(LlmIssue),
  agreements: z.array(LlmAgreement).describe("조건 없이 명시적으로 합의된 것만"),
});
export type LlmAnalysisOutput = z.infer<typeof LlmAnalysisOutput>;
export type LlmIssue = z.infer<typeof LlmIssue>;
export type LlmPosition = z.infer<typeof LlmPosition>;

// ── 저장·표시 스키마 ────────────────────────────────────────────────────────

export const CheckResult = z.object({
  /** 근거 발언 중 이 화자의 발언이 있는가 */
  speaker: z.enum(["ok", "mismatch", "unknown_speaker"]),
  /** quote 가 근거 발언 원문에 그대로 있는가 */
  quote: z.enum(["ok", "not_found"]),
  /** 판정 모델: 발언에서 이 뜻이 나오는가. 문맥 검사를 돌리지 않았으면 not_checked */
  context: z.enum(["supported", "partial", "contradicted", "not_checked"]),
  contextNote: z.string().nullable(),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const SpeakerRef = z.object({
  /** 내부 화자 키. diarization id(SPEAKER_01) 또는 이름 기반 키(N:박재인) */
  key: z.string().nullable(),
  /** 화면 표시 이름. 화자 매핑에서만 채운다 */
  name: z.string().nullable(),
  role: z.string().nullable(),
});
export type SpeakerRef = z.infer<typeof SpeakerRef>;

export const PositionV2 = z.object({
  speaker: SpeakerRef,
  meaning: z.string(),
  quote: z.string(),
  evidence: z.array(z.string()),
  slots: z.partialRecord(z.enum(SLOT_KEYS), z.string()),
  checks: CheckResult,
});
export type PositionV2 = z.infer<typeof PositionV2>;

export const SlotDiff = z.object({
  slot: z.enum(SLOT_KEYS),
  /** 서로 다른 항목에 적힌 값을 한 줄로 비교했으면 그 항목들(첫 항목이 slot). 한 항목 비교면 없다 */
  slots: z.array(z.enum(SLOT_KEYS)).optional(),
  /** 화자 키 → 값 */
  values: z.record(z.string(), z.string()),
  pairs: z.array(z.object({
    a: z.string(), b: z.string(), verdict: z.enum(["same", "different", "unclear"]),
  })).optional(),
  state: z.enum(["same", "differs"]),
  /** same/differs 판정 근거: exact(정규화 문자열 일치) 또는 judge(판정 모델의 짝 판정) */
  basis: z.string(),
});
export type SlotDiff = z.infer<typeof SlotDiff>;

export const Distance = z.object({
  differs: z.number().int(),
  compared: z.number().int(),
  /** differs / compared. compared 가 0 이면 null — 숫자를 만들지 않는다 */
  value: z.number().nullable(),
  basis: z.string(),
});
export type Distance = z.infer<typeof Distance>;

export const AlignmentIssueV2 = z.object({
  schema: z.literal(SCHEMA_VERSION),
  issue_id: z.string(),
  key: z.string(),
  meeting_id: z.string(),
  analysis_run_id: z.string(),
  data_mode: z.enum(["live", "fixture"]),
  window: z.object({ from: z.string(), to: z.string() }).nullable(),
  type: z.enum(ISSUE_TYPES),
  decision: z.string(),
  concept: z.string(),
  state: z.enum(ISSUE_STATES),
  condition: LlmCondition.nullable(),
  positions: z.array(PositionV2),
  slot_diff: z.array(SlotDiff),
  distance: Distance,
  question: z.string(),
  why_it_matters: z.string(),
  severity: z.enum(SEVERITIES),
  role_briefs: z.record(z.string(), z.string()),
  evidence_all: z.array(z.string()),
  /** 검사 과정에서 떨어진 입장·사유. 화면 "검사 기록"에 보여 준다 */
  dropped: z.array(z.object({ speaker: z.string(), reason: z.string(), evidence: z.array(z.string()) })),
  /** 코드가 바꾼 것의 기록(상태 조정, 같은 화자 입장 병합 등). 화면 "검사 기록"에 보여 준다 */
  audit: z.array(z.string()),
  /** 과거 결정 충돌일 때 대조한 과거 결정 */
  past_decisions: z.array(
    z.object({
      ledger_id: z.string(),
      meeting_id: z.string(),
      slot: z.string(),
      value: z.string(),
      evidence: z.array(z.string()),
      /** 화면 표시용. 예전 결과에는 없다 */
      meeting_title: z.string().nullable().optional(),
      decided_by: z.string().optional(),
    }),
  ),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AlignmentIssueV2 = z.infer<typeof AlignmentIssueV2>;

export const AgreementV2 = z.object({
  topic: z.string(),
  summary: z.string(),
  evidence: z.array(z.string()),
  /** 근거 발언에 조건·보류 표현이 있으면 그 표현. 조건 없는 합의면 null */
  condition: z.string().nullable(),
});
export type AgreementV2 = z.infer<typeof AgreementV2>;

/** LLM 출력용 JSON Schema. OpenRouter response_format.json_schema.schema 에 넣는다. */
export function llmOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(LlmAnalysisOutput, { target: "draft-07" }) as Record<string, unknown>;
}
