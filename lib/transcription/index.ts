/**
 * 전사 공급자 선택.
 *
 * 규칙: 키가 없으면 fixture 로 자동 전환하지 않는다. NOT_CONFIGURED 를 던진다.
 *       lib/services/shotRecipe/runtime.ts 가 DB 에 대해 지키는 규칙과 같다 —
 *       조용히 대체하면 "됐다"고 믿게 되지만 실제로는 아무것도 처리되지 않는다.
 */
import { OpenRouterTranscriptionProvider } from "./providers/openrouter";
import { TranscriptionError, type TranscriptionProvider } from "./types";

export * from "./types";
export { OpenRouterTranscriptionProvider };

const PROVIDERS: Record<string, () => TranscriptionProvider> = {
  openrouter: () => new OpenRouterTranscriptionProvider(),
};

/** 지원 확장자. 열 수 없는 파일을 공급사에 보내 요금만 쓰는 걸 막는다. */
const ALLOWED = new Set(["mp3", "wav", "m4a", "aac", "mp4", "webm", "ogg", "flac"]);
/** 한 번의 요청으로 보내는 상한. 이보다 크면 조각 전사(lib/transcription/long.ts)로 간다. */
export const MAX_DIRECT_BYTES = 24 * 1024 * 1024;
/** 전체 상한. 조각 전사도 이보다 큰 파일은 받지 않는다. */
export const MAX_BYTES = 500 * 1024 * 1024;

export function getTranscriptionProvider(): TranscriptionProvider {
  const name = (process.env.TRANSCRIPTION_PROVIDER ?? "openrouter").toLowerCase();
  const make = PROVIDERS[name];
  if (!make) throw new TranscriptionError("NOT_CONFIGURED", `알 수 없는 전사 공급자: ${name}`);
  const provider = make();
  if (!provider.isConfigured()) {
    throw new TranscriptionError(
      "NOT_CONFIGURED",
      "OPENROUTER_API_KEY 가 설정되지 않아 전사를 실행할 수 없습니다. 데모 데이터로 대체하지 않습니다.",
    );
  }
  return provider;
}

export function assertSupportedAudio(fileName: string, byteLength: number): void {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED.has(ext)) {
    throw new TranscriptionError(
      "UNSUPPORTED_FORMAT",
      `지원하지 않는 형식입니다: .${ext} (지원: ${[...ALLOWED].join(", ")})`,
    );
  }
  if (byteLength === 0) throw new TranscriptionError("UNSUPPORTED_FORMAT", "빈 파일입니다.");
  if (byteLength > MAX_BYTES) {
    throw new TranscriptionError(
      "UNSUPPORTED_FORMAT",
      `파일이 너무 큽니다 (${Math.round(byteLength / 1024 / 1024)}MB, 최대 ${MAX_BYTES / 1024 / 1024}MB).`,
    );
  }
}
