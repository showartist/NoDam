#!/usr/bin/env node
/**
 * 실제 사람 녹음으로 화자분리 정확도를 재는 스크립트.
 *
 *   node scripts/eval-diarization.mjs <audio> [정답]
 *
 * 정답은 발언 순서대로 쉼표로 적는다. 사람 이름이든 A,B,C 든 상관없다.
 *   node scripts/eval-diarization.mjs meeting.m4a A,B,C,B,A,C
 *
 * 정답을 생략하면 전사 결과만 보여준다. 그걸 보고 정답을 적어 다시 돌리면 된다.
 * .env.local 의 OPENROUTER_API_KEY 를 읽는다. 키 값은 출력하지 않는다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const [file, truthArg] = process.argv.slice(2);
if (!file) {
  console.error("사용법: node scripts/eval-diarization.mjs <audio> [정답: A,B,C,B,A,C]");
  process.exit(1);
}

for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2].trim() && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY 가 없습니다.");
  process.exit(1);
}

const MODEL = process.env.OPENROUTER_STT_MODEL ?? "x-ai/grok-stt-1.0";
const GAP_MS = Number(process.env.STT_UTTERANCE_GAP_MS ?? 400);
const audio = readFileSync(file);

const res = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: MODEL,
    response_format: "verbose_json",
    language: process.env.STT_LANGUAGE ?? "ko",
    provider: { options: { xai: { diarize: true } } },
    input_audio: { data: audio.toString("base64"), format: path.extname(file).slice(1) || "m4a" },
  }),
});
const body = await res.json();
if (!res.ok) {
  console.error("전사 실패:", body?.error?.message ?? res.status);
  process.exit(1);
}

// provider 응답 → 발언 묶기 (프로덕션 규칙과 동일: 화자 변경 또는 긴 침묵)
const words = (body.words ?? []).filter((w) => (w.word ?? w.text ?? "").trim() && w.start != null);
const seen = new Map();
const norm = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const k = String(raw);
  if (!seen.has(k)) seen.set(k, `SPEAKER_${String(seen.size + 1).padStart(2, "0")}`);
  return seen.get(k);
};
const groups = [];
let prevEnd = null;
for (const w of words) {
  const sid = norm(w.speaker);
  const last = groups.at(-1);
  const changed = !last || last.sid !== sid;
  const pause = prevEnd != null && w.start - prevEnd >= GAP_MS / 1000;
  if (changed || pause) groups.push({ sid, words: [w] });
  else last.words.push(w);
  prevEnd = w.end;
}
const utts = groups.map((g, i) => ({
  uid: `U-${String(i + 1).padStart(3, "0")}`,
  sid: g.sid,
  start: g.words[0].start,
  end: g.words.at(-1).end,
  text: g.words.map((w) => (w.word ?? w.text).trim()).join(" ").replace(/\s+([.,!?…])/g, "$1"),
}));

console.log(`\n모델: ${MODEL}`);
console.log(`Detected speakers: ${seen.size}${seen.size === 0 ? "  ← 화자 정보 없음" : ""}\n`);
for (const u of utts) {
  console.log(`${u.uid} ${String(u.sid ?? "화자 미상").padEnd(11)} [${u.start.toFixed(1)}~${u.end.toFixed(1)}s] ${u.text}`);
}

if (!truthArg) {
  console.log(`\n정답을 넣어 채점하려면:\n  node scripts/eval-diarization.mjs ${file} ${utts.map(() => "?").join(",")}`);
  process.exit(0);
}

const truth = truthArg.split(",").map((s) => s.trim());
if (truth.length !== utts.length) {
  console.log(`\n⚠️ 정답 ${truth.length}개 / 감지 발언 ${utts.length}개 — 개수가 달라 발언 단위 채점을 못 합니다.`);
  console.log("   경계 자체가 틀린 것이므로 그 자체를 실패로 봅니다.");
  process.exit(0);
}

// 정답 화자 → 예측 화자 최빈 대응으로 매핑한 뒤 채점
const pairs = truth.map((t, i) => [t, utts[i].sid]);
const mapping = new Map();
for (const t of new Set(truth)) {
  const counts = new Map();
  for (const [tt, p] of pairs) if (tt === t) counts.set(p, (counts.get(p) ?? 0) + 1);
  mapping.set(t, [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
let correct = 0;
console.log("\n=== 채점 ===");
for (let i = 0; i < pairs.length; i++) {
  const [t, p] = pairs[i];
  const okk = mapping.get(t) === p;
  if (okk) correct++;
  console.log(`  ${utts[i].uid} 정답=${t} → 예측=${p} ${okk ? "✅" : "❌"}`);
}
const consistent = [...new Set(truth)].filter((t) => pairs.filter(([tt]) => tt === t).every(([, p]) => p === mapping.get(t)));

console.log(`
전체 발언        : ${utts.length}
정확한 화자 배정 : ${correct}
오류             : ${utts.length - correct}
정확도           : ${((correct / utts.length) * 100).toFixed(1)}%
동일인 일관성    : ${consistent.length}/${new Set(truth).size} 명 (해당 인물의 모든 발언이 같은 ID)
감지 화자 수     : ${seen.size} (정답 ${new Set(truth).size}명)
`);
