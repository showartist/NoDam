// SRT/VTT → parseTranscript 변환기 계약 테스트.
// 변환 결과가 parseTranscript 를 실제로 통과하는지까지 확인한다 —
// 문자열만 그럴듯하게 만들고 끝내지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { convertSubtitleToTranscript, detectSubtitleFormat } from "../lib/transcript/subtitleToTranscript";
import { parseTranscript } from "../lib/parse";

const SRT = `1
00:00:01,000 --> 00:00:04,000
박재인: 34씬의 핵심은 수현이 이름표를 숨기는 겁니다.

2
00:00:11,500 --> 00:00:14,000
김태오: 그럼 청록 형광등으로 가시죠.

3
00:00:20,000 --> 00:00:22,000
젖은 타일 반사도 살리고요.
`;

const VTT = `WEBVTT

NOTE 이 줄은 무시되어야 한다

1
00:00:01.000 --> 00:00:04.000 align:start position:10%
박재인: 34씬의 핵심입니다.
`;

test("detect_format", () => {
  assert.equal(detectSubtitleFormat(VTT), "vtt");
  assert.equal(detectSubtitleFormat(SRT), "srt");
  assert.equal(detectSubtitleFormat("그냥 평범한 텍스트"), null);
});

test("srt_converts_to_mmss_and_parses", () => {
  const r = convertSubtitleToTranscript(SRT);
  assert.equal(r.format, "srt");
  assert.equal(r.cueCount, 3);

  // HH:MM:SS,mmm → MM:SS
  assert.match(r.transcript, /^\[00:01\] 박재인: 34씬의 핵심은/m);
  assert.match(r.transcript, /^\[00:11\] 김태오: 그럼 청록 형광등으로/m);

  // ★ 변환 결과가 실제로 parseTranscript 를 통과하는가
  const utterances = parseTranscript(r.transcript);
  assert.equal(utterances.length, 3);
  assert.equal(utterances[0].speakerName, "박재인");
  assert.equal(utterances[0].tsStart, "00:01");
  assert.equal(utterances[1].speakerName, "김태오");
});

test("cue_without_speaker_inherits_previous_and_reports", () => {
  const r = convertSubtitleToTranscript(SRT);
  // 3번 큐는 화자 라벨이 없다 → 김태오 승계
  assert.match(r.transcript, /^\[00:20\] 김태오: 젖은 타일 반사도/m);

  const inherited = r.diagnostics.filter((d) => d.code === "no_speaker_inherited");
  assert.equal(inherited.length, 1, "승계 사실을 진단에 남겨야 합니다.");
  assert.match(inherited[0].detail, /김태오/);
});

test("cue_structure_lines_never_leak_into_body", () => {
  const r = convertSubtitleToTranscript(SRT);
  // 큐 번호와 화살표가 본문에 섞이면 parseTranscript 가 직전 발언에 붙여버린다
  assert.doesNotMatch(r.transcript, /-->/);
  assert.doesNotMatch(r.transcript, /^\s*\d+\s*$/m);

  const utterances = parseTranscript(r.transcript);
  for (const u of utterances) {
    assert.doesNotMatch(u.textRaw, /-->/, "본문에 타임코드 화살표가 남으면 안 됩니다.");
    assert.doesNotMatch(u.textRaw, /00:00:\d\d,\d+/, "본문에 원본 타임코드가 남으면 안 됩니다.");
  }
});

test("vtt_header_and_note_and_cue_settings_ignored", () => {
  const r = convertSubtitleToTranscript(VTT);
  assert.equal(r.format, "vtt");
  assert.equal(r.cueCount, 1);
  assert.doesNotMatch(r.transcript, /WEBVTT|NOTE|align:start/);
  assert.match(r.transcript, /^\[00:01\] 박재인: 34씬의 핵심입니다\.$/m);
});

test("hours_accumulate_into_minutes", () => {
  const srt = `1
01:05:30,000 --> 01:05:33,000
박재인: 한 시간 넘긴 발언입니다.
`;
  const r = convertSubtitleToTranscript(srt);
  assert.match(r.transcript, /^\[65:30\] 박재인:/m, "01:05:30 은 65:30 이어야 합니다.");
  assert.equal(parseTranscript(r.transcript)[0].tsStart, "65:30");
});

test("timecode_over_99_minutes_drops_timecode_and_reports", () => {
  // parseTranscript 의 분 표기는 2자리까지다. 잘못된 시각을 쓰느니 생략한다.
  const srt = `1
01:45:00,000 --> 01:45:03,000
박재인: 105분 지점 발언입니다.
`;
  const r = convertSubtitleToTranscript(srt);
  assert.equal(r.diagnostics.filter((d) => d.code === "timecode_overflow").length, 1);
  assert.match(r.transcript, /^박재인: 105분 지점 발언입니다\.$/m);

  // 타임코드는 없어도 발언 자체는 살아야 한다
  const u = parseTranscript(r.transcript);
  assert.equal(u.length, 1);
  assert.equal(u[0].speakerName, "박재인");
  assert.equal(u[0].tsStart, null);
});

test("leading_cue_without_speaker_is_excluded_and_reported", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
화자 라벨이 아예 없는 첫 큐입니다.
`;
  const r = convertSubtitleToTranscript(srt);
  assert.equal(r.transcript, "", "승계할 화자가 없으면 본문을 지어내지 않고 제외합니다.");
  assert.equal(r.diagnostics.filter((d) => d.code === "no_speaker_unresolved").length, 1);
});

test("empty_cue_reported_not_silently_dropped", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000

2
00:00:05,000 --> 00:00:07,000
박재인: 실제 발언.
`;
  const r = convertSubtitleToTranscript(srt);
  assert.equal(r.diagnostics.filter((d) => d.code === "empty_cue").length, 1);
  assert.equal(parseTranscript(r.transcript).length, 1);
});

test("speaker_with_role_label_survives_round_trip", () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
박재인(감독): 역할 표기가 유지되어야 합니다.
`;
  const r = convertSubtitleToTranscript(srt);
  const u = parseTranscript(r.transcript)[0];
  assert.equal(u.speakerName, "박재인");
  assert.equal(u.role, "감독", "괄호 역할 표기가 parseTranscript 까지 전달되어야 합니다.");
});

test("crlf_and_bom_normalized", () => {
  const srt = "﻿1\r\n00:00:01,000 --> 00:00:03,000\r\n박재인: CRLF 파일입니다.\r\n";
  const r = convertSubtitleToTranscript(srt);
  assert.equal(r.cueCount, 1);
  assert.equal(parseTranscript(r.transcript)[0].speakerName, "박재인");
});
