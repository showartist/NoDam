import { AUDIO_POLICY } from "../policy";
/**
 * OpenRouter 전사 공급자 (Grok STT + speaker diarization).
 *
 * POST https://openrouter.ai/api/v1/audio/transcriptions
 *
 * 2026-08-22 실측으로 확인한 것:
 *   - x-ai/grok-stt-1.0 은 한국어를 정확히 전사하고 word 단위 timestamp 를 준다.
 *   - 화자분리는 **최상위 diarize 로는 켜지지 않는다**. 200 을 돌려주지만 무시된다.
 *     반드시 provider.options.xai.diarize 로 넣어야 words[].speaker 가 채워진다.
 *   - speaker 는 word 에만 붙는다. segments 에는 없다.
 *   - speaker confidence 는 응답에 없다. 만들어내지 않는다.
 */
import {
  TranscriptionError,
  type TranscribeInput,
  type TranscriptResult,
  type TranscriptUtterance,
  type TranscriptionProvider,
} from "../types";

const ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
const DEFAULT_MODEL = "x-ai/grok-stt-1.0";

/** 같은 화자 안에서 이 간격 이상 끊기면 발언을 나눈다. 화자가 바뀌면 간격과 무관하게 나눈다. */
const UTTERANCE_GAP_MS = Number(process.env.STT_UTTERANCE_GAP_MS ?? 400);

export type RawWord = {
  word?: string | null;
  text?: string | null;
  start?: number | null;
  end?: number | null;
  /** Grok 이 주는 화자 번호. 정수이며 연속이라는 보장이 없다. */
  speaker?: number | string | null;
};
type Segment = { start?: number | null; end?: number | null; text?: string | null; speaker?: string | null };

export class OpenRouterTranscriptionProvider implements TranscriptionProvider {
  readonly name = "openrouter";
  readonly model: string;

  constructor(model?: string) {
    this.model = model ?? process.env.OPENROUTER_STT_MODEL ?? DEFAULT_MODEL;
  }

  private key(): string | null {
    const k = process.env.OPENROUTER_API_KEY?.trim();
    return k ? k : null;
  }

  isConfigured(): boolean {
    return this.key() !== null;
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    const key = this.key();
    if (!key) {
      throw new TranscriptionError(
        "NOT_CONFIGURED",
        "OPENROUTER_API_KEY 가 설정되지 않았습니다. 전사를 수행할 수 없습니다.",
      );
    }

    const format = input.fileName.split(".").pop()?.toLowerCase() || "m4a";
    const body = {
      model: this.model,
      response_format: "verbose_json",
      language: input.languageCode ?? "ko",
      // 화자분리는 여기로만 켜진다. 최상위로 올리면 조용히 무시된다.
      provider: { options: { xai: { diarize: true } } },
      input_audio: { data: Buffer.from(input.audio).toString("base64"), format },
    };

    const signal = AbortSignal.timeout(AUDIO_POLICY.providerTimeoutMs);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw new TranscriptionError(signal.aborted ? "TIMEOUT" : "PROVIDER_ERROR", signal.aborted ? "OpenRouter 전사가 60초를 초과했습니다." : `OpenRouter 전사 요청 실패: ${(e as Error).message}`);
    }

    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (signal.aborted) throw new TranscriptionError("TIMEOUT", "OpenRouter 전사 응답이 60초를 초과했습니다.");
    if (!res.ok || !payload) {
      const msg = (payload?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
      throw new TranscriptionError("TRANSCRIPTION_FAILED", `OpenRouter 전사 실패: ${msg}`, { status: res.status, payload });
    }

    const text = String(payload.text ?? "").trim();
    if (!text) throw new TranscriptionError("NO_SPEECH", "오디오에서 발언을 찾지 못했습니다.");

    const words = (payload.words as RawWord[] | undefined) ?? [];
    const segments = (payload.segments as Segment[] | undefined) ?? [];
    const durationMs = typeof payload.duration === "number" ? Math.round(payload.duration * 1000) : null;

    const built = buildUtterances(words, segments, text, durationMs);
    if (built.utterances.length === 0) {
      throw new TranscriptionError("NO_SPEECH", "전사 결과를 발언 단위로 나누지 못했습니다.");
    }

    return {
      provider: this.name,
      model: this.model,
      language: (payload.language as string | undefined) ?? input.languageCode ?? null,
      text,
      utterances: built.utterances,
      diarizationStatus: built.speakerCount > 0 ? "ok" : "unsupported",
      speakerCount: built.speakerCount > 0 ? built.speakerCount : null,
      durationMs,
      sourceFileName: input.fileName,
      words: toWords(words),
    };
  }
}

/** 공급자 word 목록 → 내부 단어(ms). 시간이 없는 단어는 버린다. */
export function toWords(words: RawWord[]): { text: string; startMs: number; endMs: number; speaker: string | null }[] {
  return words
    .filter((w) => wordText(w) && typeof w.start === "number" && typeof w.end === "number")
    .map((w) => ({
      text: wordText(w),
      startMs: Math.max(0, Math.round((w.start as number) * 1000)),
      endMs: Math.max(0, Math.round((w.end as number) * 1000)),
      speaker: w.speaker === null || w.speaker === undefined || w.speaker === "" ? null : String(w.speaker),
    }));
}

/**
 * 공급사 화자 번호를 내부 ID 로 바꾼다.
 *
 * 등장 순서 기준이며 회의 내내 안정적이다. Grok 이 7, 2, 11 처럼 비연속 값을 주더라도
 * 처음 나온 순서대로 SPEAKER_01, SPEAKER_02, SPEAKER_03 이 되고, 같은 원본 값은 언제
 * 다시 나오든 같은 내부 ID 로 돌아온다.
 */
export function createSpeakerNormalizer(): (raw: unknown) => string | null {
  const seen = new Map<string, string>();
  return (raw: unknown) => {
    if (raw === null || raw === undefined || raw === "") return null;
    const key = String(raw);
    const hit = seen.get(key);
    if (hit) return hit;
    const id = `SPEAKER_${String(seen.size + 1).padStart(2, "0")}`;
    seen.set(key, id);
    return id;
  };
}

/**
 * word 목록을 발언 단위로 묶는다.
 *
 * 경계 규칙
 *   강한 경계 — 화자가 바뀌면 침묵이 짧아도 무조건 나눈다.
 *   강한 경계 — 같은 화자라도 UTTERANCE_GAP_MS 이상 끊기면 나눈다.
 *   같은 화자에 짧은 pause 면 나누지 않는다.
 *
 * word 가 없으면 공급사 segments 를 쓰고, 그것도 없으면 전체를 발언 하나로 둔다.
 * 어느 경로든 화자 정보가 없으면 speakerId 는 null 이다. 임의 화자를 만들지 않는다.
 */
export function buildUtterances(
  words: RawWord[],
  segments: Segment[] = [],
  fullText = "",
  durationMs: number | null = null,
): { utterances: TranscriptUtterance[]; speakerCount: number } {
  const usable = words.filter((w) => wordText(w) && w.start != null && w.end != null);

  if (usable.length > 0) {
    const normalize = createSpeakerNormalizer();
    const speakers = new Set<string>();
    const groups: { speakerId: string | null; words: RawWord[] }[] = [];
    let prevEnd: number | null = null;

    for (const w of usable) {
      const speakerId = normalize(w.speaker);
      if (speakerId) speakers.add(speakerId);

      const last = groups[groups.length - 1];
      const speakerChanged = !last || last.speakerId !== speakerId;
      const longPause = prevEnd != null && (w.start as number) - prevEnd >= UTTERANCE_GAP_MS / 1000;

      if (!last || speakerChanged || longPause) groups.push({ speakerId, words: [w] });
      else last.words.push(w);

      prevEnd = w.end as number;
    }

    return {
      utterances: groups.map((g) => ({
        speakerId: g.speakerId,
        speakerName: null, // 이름은 사람이 붙인다. 추측하지 않는다.
        startMs: toMs(g.words[0].start),
        endMs: toMs(g.words[g.words.length - 1].end),
        text: joinWords(g.words),
        confidence: null, // 응답에 speaker confidence 가 없다. 지어내지 않는다.
      })),
      speakerCount: speakers.size,
    };
  }

  const segs = segments.map((s) => ({ ...s, text: (s.text ?? "").trim() })).filter((s) => s.text);
  if (segs.length > 0) {
    const normalize = createSpeakerNormalizer();
    const speakers = new Set<string>();
    const utterances = segs.map((s) => {
      const speakerId = normalize(s.speaker);
      if (speakerId) speakers.add(speakerId);
      return {
        speakerId,
        speakerName: null,
        startMs: toMs(s.start),
        endMs: toMs(s.end),
        text: s.text,
        confidence: null,
      };
    });
    return { utterances, speakerCount: speakers.size };
  }

  if (!fullText) return { utterances: [], speakerCount: 0 };
  return {
    utterances: [
      { speakerId: null, speakerName: null, startMs: 0, endMs: durationMs, text: fullText, confidence: null },
    ],
    speakerCount: 0,
  };
}

const wordText = (w: RawWord): string => String(w.word ?? w.text ?? "").trim();
const joinWords = (ws: RawWord[]): string =>
  ws.map(wordText).join(" ").replace(/\s+([.,!?…])/g, "$1").trim();
const toMs = (s: number | null | undefined): number | null =>
  typeof s === "number" && Number.isFinite(s) ? Math.max(0, Math.round(s * 1000)) : null;
