/**
 * 음성 사이드카(sidecar/, 로컬 파이썬) 클라이언트.
 *
 * uvicorn 은 쉬는 연결을 5초 뒤에 닫는데, Node fetch 가 그 연결을 다시 쓰면 ECONNRESET 이 난다.
 * 네트워크 오류는 한 번 다시 시도한다(HTTP 오류는 다시 시도하지 않는다).
 */
const BASE = process.env.SIDECAR_URL ?? `http://127.0.0.1:${process.env.SIDECAR_PORT ?? 8790}`;

export class SidecarError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = "SidecarError";
  }
}

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  let last: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new SidecarError(`사이드카 ${path} 실패: ${j?.detail ?? `HTTP ${r.status}`}`, r.status);
      return j as T;
    } catch (e) {
      if (e instanceof SidecarError) throw e;
      last = e;
      if (ctrl.signal.aborted) break;
    } finally {
      clearTimeout(t);
    }
  }
  throw new SidecarError(`사이드카에 연결하지 못했습니다: ${(last as Error)?.message ?? "알 수 없는 오류"}`);
}

export async function sidecarHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const j = await call<{ ok: boolean }>("/health", undefined, timeoutMs);
    return !!j.ok;
  } catch {
    return false;
  }
}

export type SpeakerSegment = { start_ms: number; end_ms: number; speaker: string };

export async function diarize(audioPath: string, opts: { numSpeakers?: number | null; maxSpeakers?: number; timeoutMs?: number } = {}): Promise<{ segments: SpeakerSegment[]; num_speakers: number; method: string }> {
  return call("/diarize", { audio_path: audioPath, num_speakers: opts.numSpeakers ?? null, max_speakers: opts.maxSpeakers ?? 10 }, opts.timeoutMs ?? 600_000);
}

export async function embed(audioPath: string, segments: { start_ms: number; end_ms: number }[]): Promise<(number[] | null)[]> {
  const j = await call<{ embeddings: (number[] | null)[] }>("/embed", { audio_path: audioPath, segments }, 300_000);
  return j.embeddings;
}
