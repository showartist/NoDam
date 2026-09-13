/**
 * 전사(STT) 계층 내부 표준 타입.
 *
 * 공급사 응답 형태를 DB·UI 가 직접 쓰지 않는다. 어떤 공급사를 붙이든 TranscriptResult 로
 * 변환한 뒤에만 상위로 넘어간다. 공급사를 바꿀 때 바뀌는 파일은 providers/ 아래 하나여야 한다.
 */

/** 화자분리 결과 상태. 화자를 모르면 모른다고 적는다. 임의 화자를 만들지 않는다. */
export type DiarizationStatus =
  | "unsupported"  // 공급사/모델이 화자 정보를 제공하지 않음
  | "failed"       // 요청했으나 화자 정보를 받지 못함
  | "ok";          // 실제 화자 라벨을 받음

export type TranscriptUtterance = {
  /** diarization identity. 실제 화자 정보가 없으면 반드시 null. */
  speakerId: string | null;
  /** 사람이 붙인 표시 이름. 전사 시점에는 알 수 없으므로 null. */
  speakerName: string | null;
  startMs: number | null;
  endMs: number | null;
  text: string;
  confidence: number | null;
};

export type TranscriptResult = {
  provider: string;
  model: string;
  language: string | null;
  /** 전체 전사 원문. */
  text: string;
  utterances: TranscriptUtterance[];
  diarizationStatus: DiarizationStatus;
  /** 화자 수. diarizationStatus 가 ok 일 때만 의미가 있다. */
  speakerCount: number | null;
  durationMs: number | null;
  sourceFileName: string;
  /**
   * 단어 단위 타임스탬프(공급자가 주면). 화자를 사이드카 화자분리로 다시 붙일 때 쓴다.
   * speaker 는 공급자가 준 조각 안 번호이며, 회의 단위 화자가 아니다.
   */
  words?: TranscriptWord[];
};

export type TranscriptWord = { text: string; startMs: number; endMs: number; speaker: string | null };

export type TranscribeInput = {
  audio: ArrayBuffer;
  fileName: string;
  languageCode?: string;
  /** 예상 화자 수. 공급사가 지원하면 힌트로 전달. */
  expectedSpeakers?: number | null;
};

export type TranscriptionErrorCode =
  | "NOT_CONFIGURED"
  | "UNSUPPORTED_FORMAT"
  | "TRANSCRIPTION_FAILED"
  | "NO_SPEECH"
  | "TIMEOUT"
  | "PROVIDER_ERROR";

export class TranscriptionError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  transcribe(input: TranscribeInput): Promise<TranscriptResult>;
}
