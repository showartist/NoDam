/**
 * 전사 결과에 사이드카 화자분리를 입힌다. 사이드카가 꺼져 있거나 단어 타임스탬프가 없으면
 * 원래 결과를 그대로 돌려주고 이유를 적는다(가짜로 화자를 만들지 않는다).
 */
import { diarize, sidecarHealth } from "../audio/sidecar";
import { resegment } from "./resegment";
import type { TranscriptResult } from "./types";

export type SpeakerSource = "sidecar" | "provider" | "none";

export async function withSidecarSpeakers(
  result: TranscriptResult,
  audioPath: string,
  opts: { numSpeakers?: number | null; timeoutMs?: number } = {},
): Promise<{ result: TranscriptResult; speakerSource: SpeakerSource; note: string | null }> {
  if (!result.words?.length) {
    return { result, speakerSource: result.diarizationStatus === "ok" ? "provider" : "none", note: "단어 타임스탬프가 없어 공급자 화자 정보를 그대로 씀" };
  }
  if (!(await sidecarHealth())) {
    return { result, speakerSource: result.diarizationStatus === "ok" ? "provider" : "none", note: result.diarizationStatus === "ok" ? "사이드카가 꺼져 있어 공급자 화자 정보를 그대로 씀" : "회의 전체 화자 연결을 확인하지 못했습니다. 발언은 보존하고 화자는 미확인으로 표시합니다." };
  }
  const d = await diarize(audioPath, { numSpeakers: opts.numSpeakers ?? null, timeoutMs: opts.timeoutMs });
  const spans = d.segments.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms, speaker: s.speaker }));
  const r = resegment(result.words, spans);
  if (r.utterances.length === 0) return { result, speakerSource: "provider", note: "다시 나눈 발언이 없어 공급자 결과를 씀" };
  return {
    result: {
      ...result,
      utterances: r.utterances,
      diarizationStatus: r.speakerCount > 0 ? "ok" : "unsupported",
      speakerCount: r.speakerCount || null,
    },
    speakerSource: "sidecar",
    note: `사이드카 화자분리(${d.method}, ${d.num_speakers}명)`,
  };
}
