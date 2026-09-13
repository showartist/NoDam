/**
 * Grok diarization 배선 계약.
 *
 * 실제로 겪은 함정: 최상위 diarize:true 는 OpenRouter 가 200 으로 받아주지만 조용히
 * 무시한다. provider.options.xai.diarize 로 넣어야만 words[].speaker 가 채워진다.
 * 옵션이 최상위로 옮겨가는 회귀를 여기서 잡는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildUtterances, createSpeakerNormalizer, type RawWord } from "../lib/transcription/providers/openrouter";

const src = readFileSync(new URL("../lib/transcription/providers/openrouter.ts", import.meta.url), "utf8");

const w = (word: string, start: number, end: number, speaker?: number | string | null): RawWord => ({
  word, start, end, ...(speaker === undefined ? {} : { speaker }),
});

test("TEST A: diarization 옵션은 provider.options.xai.diarize 여야 한다", () => {
  assert.match(
    src.replace(/\s+/g, " "),
    /provider: \{ options: \{ xai: \{ diarize: true \} \} \}/,
    "provider.options.xai.diarize 로 보내야 화자분리가 켜진다.",
  );
  // 최상위 diarize 로 옮기면 무시되므로 금지한다 (주석 설명은 제외하고 검사).
  const code = src.split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
  assert.ok(
    !/^\s*diarize:\s*true/m.test(code),
    "최상위 diarize 는 OpenRouter 가 무시한다. provider.options.xai 안에 있어야 한다.",
  );
});

test("TEST B: 비연속 raw speaker 를 등장 순서대로 정규화한다", () => {
  const n = createSpeakerNormalizer();
  assert.deepEqual([7, 7, 2, 2, 11, 7].map(n), [
    "SPEAKER_01", "SPEAKER_01", "SPEAKER_02", "SPEAKER_02", "SPEAKER_03", "SPEAKER_01",
  ]);
});

test("TEST C: 화자가 바뀌면 침묵 100ms 여도 발언을 나눈다", () => {
  const { utterances, speakerCount } = buildUtterances([
    w("이번", 0.0, 0.4, 0), w("광고는", 0.4, 0.9, 0),
    w("저는", 1.0, 1.4, 1), // 간격 100ms 뿐이지만 화자가 바뀜
  ]);
  assert.equal(utterances.length, 2, "화자 변경은 강한 경계다.");
  assert.equal(utterances[0].speakerId, "SPEAKER_01");
  assert.equal(utterances[1].speakerId, "SPEAKER_02");
  assert.equal(speakerCount, 2);
});

test("TEST C-2: 같은 화자면 짧은 pause 로 쪼개지 않는다", () => {
  const { utterances } = buildUtterances([
    w("이번", 0.0, 0.4, 0), w("광고는", 0.5, 0.9, 0), w("심플하게", 1.0, 1.5, 0),
  ]);
  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].text, "이번 광고는 심플하게");
});

test("TEST C-3: 같은 화자라도 긴 침묵이면 나눈다", () => {
  const { utterances } = buildUtterances([
    w("먼저", 0.0, 0.4, 0),
    w("그리고", 2.0, 2.4, 0), // 1600ms 침묵
  ]);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[0].speakerId, utterances[1].speakerId);
});

test("TEST D: 같은 raw speaker 가 다시 나오면 같은 SPEAKER_ID 로 돌아온다", () => {
  const { utterances, speakerCount } = buildUtterances([
    w("A첫번째", 0.0, 0.5, 0),
    w("B발언", 1.0, 1.5, 1),
    w("A두번째", 2.0, 2.5, 0),
  ]);
  assert.deepEqual(utterances.map((u) => u.speakerId), ["SPEAKER_01", "SPEAKER_02", "SPEAKER_01"]);
  assert.equal(speakerCount, 2, "화자는 2명이다. 발언마다 새 화자를 만들지 않는다.");
});

test("TEST E: speaker 필드가 없으면 speakerId 는 null 이고 화자를 만들지 않는다", () => {
  const { utterances, speakerCount } = buildUtterances([
    w("이번", 0.0, 0.4), w("광고는", 0.5, 0.9),
    w("다음발언", 2.0, 2.4),
  ]);
  assert.equal(speakerCount, 0);
  assert.ok(utterances.every((u) => u.speakerId === null), "임의 화자를 생성하면 안 된다.");
  assert.equal(utterances.length, 2, "화자 정보가 없어도 침묵 기준 분리는 유지된다.");
});

test("TEST F: 전사 텍스트가 변형/누락되지 않는다", () => {
  const { utterances } = buildUtterances([
    w("이번", 0.0, 0.3, 0), w("광고는", 0.35, 0.7, 0), w("심플하게", 0.75, 1.2, 0), w("갑시다.", 1.25, 1.7, 0),
    w("버튼을", 2.5, 2.9, 1), w("줄이죠.", 2.95, 3.4, 1),
  ]);
  assert.equal(utterances.map((u) => u.text).join(" "), "이번 광고는 심플하게 갑시다. 버튼을 줄이죠.");
});

test("speaker confidence 를 지어내지 않는다", () => {
  const { utterances } = buildUtterances([w("하나", 0, 0.5, 0)]);
  assert.equal(utterances[0].confidence, null);
});
