/**
 * STT 단어 + 사이드카 화자 구간 → 화자가 붙은 발언.
 *
 * 합성 회의 3건 실측(fixtures/eval/results/diarization-20260911.md): Grok 이 주는 화자 번호는 DER 42~60%로
 * 여러 사람을 한 번호로 합쳤고, 사이드카 화자분리는 DER 5~11%였다. 그래서 글자는 Grok 에서, "누가"는
 * 사이드카에서 가져온다(두 가지를 합친 방식 DER 13~17%, 발언 단위 화자 100%).
 *
 * 단어마다 겹치는 시간이 가장 긴 화자 구간을 고르고, 겹치는 구간이 없으면 가장 가까운 구간을 쓴다(1초 이내).
 * 그다음 lib/transcription/providers/openrouter.ts 의 발언 경계 규칙(화자가 바뀌거나 gapMs 이상 쉬면 나눔)을 그대로 쓴다.
 */
import type { TranscriptUtterance, TranscriptWord } from "./types";

export type SpeakerSpan = { startMs: number; endMs: number; speaker: string };

export function speakerForWord(w: { startMs: number; endMs: number }, spans: SpeakerSpan[], maxGapMs = 1000): string | null {
  let best: { s: string; ov: number } | null = null;
  let near: { s: string; d: number } | null = null;
  for (const sp of spans) {
    const ov = Math.min(w.endMs, sp.endMs) - Math.max(w.startMs, sp.startMs);
    if (ov > 0 && (!best || ov > best.ov)) best = { s: sp.speaker, ov };
    const d = ov > 0 ? 0 : Math.min(Math.abs(w.startMs - sp.endMs), Math.abs(sp.startMs - w.endMs));
    if (!near || d < near.d) near = { s: sp.speaker, d };
  }
  if (best) return best.s;
  if (near && near.d <= maxGapMs) return near.s;
  return null;
}

const joinWords = (ws: string[]): string => ws.join(" ").replace(/\s+([.,!?…])/g, "$1").trim();

export function resegment(words: TranscriptWord[], spans: SpeakerSpan[], gapMs = Number(process.env.STT_UTTERANCE_GAP_MS ?? 400)): { utterances: TranscriptUtterance[]; speakerCount: number } {
  const groups: { speaker: string | null; words: TranscriptWord[] }[] = [];
  let prevEnd: number | null = null;
  for (const w of [...words].sort((a, b) => a.startMs - b.startMs)) {
    const sp = speakerForWord(w, spans);
    const last = groups[groups.length - 1];
    const longPause = prevEnd != null && w.startMs - prevEnd >= gapMs;
    if (!last || last.speaker !== sp || longPause) groups.push({ speaker: sp, words: [w] });
    else last.words.push(w);
    prevEnd = w.endMs;
  }
  // 등장 순서대로 SPEAKER_01… 로 바꾼다(사이드카 라벨 S1.. 은 파일마다 다시 매겨진다).
  const ids = new Map<string, string>();
  const idOf = (s: string | null) => {
    if (!s) return null;
    if (!ids.has(s)) ids.set(s, `SPEAKER_${String(ids.size + 1).padStart(2, "0")}`);
    return ids.get(s)!;
  };
  const utterances = groups.map((g) => ({
    speakerId: idOf(g.speaker),
    speakerName: null,
    startMs: g.words[0].startMs,
    endMs: g.words[g.words.length - 1].endMs,
    text: joinWords(g.words.map((w) => w.text)),
    confidence: null,
  }));
  return { utterances, speakerCount: ids.size };
}
