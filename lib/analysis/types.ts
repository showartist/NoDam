/** 동상이몽 분석의 내부 표준 타입. LLM 응답 형태를 UI 가 직접 쓰지 않는다. */

export type Interpretation = {
  /** diarization identity. 화자를 모르면 null. */
  speakerId: string | null;
  /** 사람이 붙인 이름. 매핑 전에는 null. */
  speakerName: string | null;
  /** 이 사람이 그 표현을 어떤 뜻으로 썼는가. */
  meaning: string;
  /** 반드시 실제 발언 U-ID. 비어 있으면 그 해석은 버린다. */
  evidenceUids: string[];
};

export type AlignmentIssueLlm = {
  /** 무엇에 대한 결정인가. */
  decision: string;
  /** 서로 다르게 이해된 표현. */
  concept: string;
  status: "needs_confirmation" | "conflict";
  interpretations: Interpretation[];
  differenceSummary: string;
  impact: "high" | "medium" | "low";
  confidence: number | null;
};

export type ExplicitAgreement = {
  topic: string;
  summary: string;
  evidenceUids: string[];
};

export type AnalysisStatus = "not_run" | "completed" | "failed";

export type DongSangAnalysis = {
  status: AnalysisStatus;
  provider: string | null;
  model: string | null;
  /** 동상이몽이 없으면 빈 배열. 억지로 만들지 않는다. */
  issues: AlignmentIssueLlm[];
  agreements: ExplicitAgreement[];
  error?: string | null;
};

export type AnalysisInputUtterance = {
  uid: string;
  speakerId: string | null;
  speakerName: string | null;
  text: string;
};

export class AnalysisError extends Error {
  constructor(
    readonly code: "NOT_CONFIGURED" | "LLM_FAILED" | "INVALID_OUTPUT" | "NO_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisError";
  }
}
