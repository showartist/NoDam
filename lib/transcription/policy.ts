/** 오디오 길이는 처리 시간이 아니다. 요청당 최대 2개만 처리하고 체크포인트로 이어간다. */
const PROVIDER_TIMEOUT_MS = 60_000;
export const AUDIO_POLICY = {
  providerTimeoutMs: PROVIDER_TIMEOUT_MS,
  chunkMs: PROVIDER_TIMEOUT_MS / 2,
  overlapMs: 3_000,
  concurrency: 2,
  retries: 2,
  retryBaseMs: 1_000,
  encodeTimeoutMs: 15_000,
  requestSeconds: 300,
} as const;
// 한 배치 최악: 인코딩 30초 + 공급자 60초×3 + 대기 3초 = 213초 (<300초).
