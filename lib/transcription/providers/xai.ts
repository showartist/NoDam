/**
 * xAI Grok STT 직접 호출 (REST /v1/stt). XAI_API_KEY 가 있을 때만 쓴다.
 *
 * OpenRouter 경로와 같은 모델이지만, 파일 하나를 500MB 까지 보낼 수 있고 OpenRouter 의 공급자 60초
 * 타임아웃이 없어 긴 회의를 자르지 않고 전사한다(화자 번호가 회의 끝까지 이어진다).
 * 응답의 words[].speaker 를 OpenRouter 공급자와 같은 규칙(buildUtterances)으로 발언으로 묶는다.
 *
 * 2026-09-11 기준 문서(docs.x.ai speech-to-text)를 따랐고, 이 맥에는 xAI 키가 없어 실제 호출로는
 * 확인하지 못했다. 응답 형식이 다르면 TRANSCRIPTION_FAILED 로 드러난다.
 */
import { buildUtterances, toWords, type RawWord } from "./openrouter";
import { TranscriptionError, type TranscribeInput, type TranscriptResult, type TranscriptionProvider } from "../types";

const ENDPOINT = process.env.XAI_STT_URL ?? "https://api.x.ai/v1/stt";

export class XaiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "xai";
  readonly model = process.env.XAI_STT_MODEL ?? "grok-stt-1.0";

  private key(): string | null {
    const k = process.env.XAI_API_KEY?.trim();
    return k ? k : null;
  }

  isConfigured(): boolean {
    return this.key() !== null;
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    const key = this.key();
    if (!key) throw new TranscriptionError("NOT_CONFIGURED", "XAI_API_KEY 가 설정되지 않았습니다.");
    const form = new FormData();
    form.append("file", new Blob([input.audio]), input.fileName);
    form.append("model", this.model);
    form.append("language", input.languageCode ?? "ko");
    form.append("diarize", "true");
    form.append("response_format", "verbose_json");
    if (input.expectedSpeakers) form.append("num_speakers", String(input.expectedSpeakers));

    let res: Response;
    try {
      res = await fetch(ENDPOINT, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form });
    } catch (e) {
      throw new TranscriptionError("PROVIDER_ERROR", `xAI 전사 요청 실패: ${(e as Error).message}`);
    }
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !payload) {
      const msg = (payload?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
      throw new TranscriptionError("TRANSCRIPTION_FAILED", `xAI 전사 실패: ${msg}`, payload);
    }
    const text = String(payload.text ?? "").trim();
    if (!text) throw new TranscriptionError("NO_SPEECH", "오디오에서 발언을 찾지 못했습니다.");
    const words = (payload.words as RawWord[] | undefined) ?? [];
    const durationMs = typeof payload.duration === "number" ? Math.round(payload.duration * 1000) : null;
    const built = buildUtterances(words, [], text, durationMs);
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
