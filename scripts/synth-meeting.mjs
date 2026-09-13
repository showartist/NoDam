#!/usr/bin/env node
/**
 * 대본(발언 목록)을 여러 목소리의 합성 회의 음성으로 만든다. 화자분리 평가용 정답 파일도 같이 쓴다.
 *
 *   node scripts/synth-meeting.mjs --transcript <file> --out fixtures/eval/audio/<name> [옵션]
 *
 * 입력 (--transcript)
 *   - JSON 배열 [{uid, speaker, role, text}]
 *   - JSON 객체 중 transcript 필드가 "U01 00:00 이름(역할): 발언" 줄 모음인 것 (fixtures/inputs/*.json)
 *   - .md/.txt 안의 "U01 00:00 이름(역할): 발언" 줄 (fixtures/film/*.transcript.md)
 *
 * 옵션
 *   --engine openrouter|say   기본 openrouter (OPENROUTER_API_KEY 가 없으면 say 로 떨어진다)
 *   --model <id>              기본 google/gemini-3.1-flash-tts-preview
 *   --voices "이름=Voice,..."  화자별 목소리. 빠진 화자는 기본 풀에서 등장 순서대로 받는다.
 *   --seed <n>                발언 사이 간격 난수 시드 (기본 20260911)
 *   --concurrency <n>         동시 TTS 요청 수 (기본 3)
 *   --limit <n>               앞 n개 발언만 (시험용)
 *
 * 출력 (--out 폴더)
 *   meeting.wav (16 kHz mono) · meeting.m4a · gold_segments.json · voices.json · transcript.json · tts_usage.json
 *
 * 발언별 TTS 결과는 fixtures/eval/audio/.tts-cache/<sha1>.wav 에 둔다. 다시 돌려도 재과금되지 않는다.
 * 정답 구간은 이어 붙인 오프셋에서 계산한다 (앞뒤 무음을 잘라낸 각 클립의 ffprobe 길이 + 간격).
 * 키 값은 어디에도 출력하지 않는다.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath 필수: 경로에 한글(4_씬노트)이 있어 URL.pathname 은 퍼센트 인코딩된 다른 경로가 된다.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = path.join(ROOT, "fixtures/eval/audio/.tts-cache");
const SR = 16000;
const CACHE_VERSION = 1;
/** 클립 앞뒤 무음 제거 (-45 dB peak, 50 ms 여유). 발언 안의 쉼은 건드리지 않는다. */
const TRIM_FILTER = [
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05:detection=peak",
  "areverse",
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05:detection=peak",
  "areverse",
].join(",");

// ── 인자 ──────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
if (!args.transcript || !args.out) {
  console.error("사용법: node scripts/synth-meeting.mjs --transcript <file> --out <dir> [--engine openrouter|say] [--voices 이름=Voice,...]");
  process.exit(1);
}
loadEnvLocal();
const KEY = process.env.OPENROUTER_API_KEY?.trim() || null;
let ENGINE = args.engine ?? (KEY ? "openrouter" : "say");
if (ENGINE === "openrouter" && !KEY) {
  console.warn("OPENROUTER_API_KEY 가 없어 macOS say 로 합성합니다.");
  ENGINE = "say";
}
const MODEL = args.model ?? "google/gemini-3.1-flash-tts-preview";
const SEED = Number(args.seed ?? 20260911);
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 3));
const OUT = path.resolve(args.out);

/**
 * Gemini 3.1 Flash TTS 30개 목소리 중 같은 한국어 문장을 ECAPA 임베딩으로 비교해
 * 서로 가장 먼 6개 (쌍별 코사인 최대 0.37). 남·여를 번갈아 둔다.
 */
const OPENROUTER_POOL = ["Orus", "Autonoe", "Algenib", "Despina", "Vindemiatrix", "Schedar"];
/**
 * 이 맥의 say 는 ko_KR 목소리 이름(Eddy, Reed, Flo …)을 줘도 한국어 문장이면 전부 Yuna 와
 * 바이트까지 같은 소리를 낸다 (2026-09-11 md5 로 확인). 그래서 Yuna 의 음높이·포먼트를 화자마다
 * 다르게 옮겨 구분되게 만든다. "Yuna@0.8" = 0.8배.
 */
const SAY_POOL = ["Yuna@1.0", "Yuna@0.78", "Yuna@1.2", "Yuna@0.68", "Yuna@1.34", "Yuna@0.9"];

// ── 대본 ──────────────────────────────────────────────────────────────────
let utterances = readTranscript(path.resolve(args.transcript));
if (args.limit) utterances = utterances.slice(0, Number(args.limit));
if (utterances.length === 0) {
  console.error("발언을 찾지 못했습니다.");
  process.exit(1);
}
for (const u of utterances) u.spoken_text = spokenText(u.text);

const speakers = [];
for (const u of utterances) if (!speakers.some((s) => s.speaker === u.speaker)) speakers.push({ speaker: u.speaker, role: u.role });
const explicit = parseVoiceMap(args.voices);
const pool = (ENGINE === "say" ? SAY_POOL : OPENROUTER_POOL).filter((v) => !Object.values(explicit).includes(v));
for (const s of speakers) s.voice = explicit[s.speaker] ?? pool.shift();
if (speakers.some((s) => !s.voice)) {
  console.error(`목소리가 모자랍니다: 화자 ${speakers.length}명. --voices 로 지정하십시오.`);
  process.exit(1);
}
const voiceOf = Object.fromEntries(speakers.map((s) => [s.speaker, s.voice]));
const dupes = speakers.filter((s, i) => speakers.findIndex((t) => t.voice === s.voice) !== i);
if (dupes.length) console.warn(`경고: 같은 목소리를 쓰는 화자가 있습니다: ${dupes.map((d) => d.speaker).join(", ")}`);

// ── 합성 (캐시) ───────────────────────────────────────────────────────────
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT, { recursive: true });
const usage = { engine: ENGINE, model: ENGINE === "say" ? "macos-say" : MODEL, requests: 0, cache_hits: 0, chars_billed: 0, chars_total: 0, generation_ids: [], cost_usd_this_run: 0, cost_usd_all_clips: 0 };

console.log(`${utterances.length}개 발언 · 화자 ${speakers.length}명 · ${ENGINE}${ENGINE === "openrouter" ? ` (${MODEL})` : ""}`);
for (const s of speakers) console.log(`  ${s.speaker}(${s.role}) → ${s.voice}`);

const clips = new Array(utterances.length);
let done = 0;
await runPool(utterances.map((u, i) => async () => {
  clips[i] = await synthCached(u.spoken_text, voiceOf[u.speaker]);
  done++;
  if (done % 10 === 0 || done === utterances.length) console.log(`  합성 ${done}/${utterances.length}`);
}), CONCURRENCY);

// 비용은 generation 통계에서 읽는다 (응답 직후엔 없을 수 있어 조금 기다렸다 재시도).
if (usage.generation_ids.length) {
  console.log(`  비용 조회 ${usage.generation_ids.length}건…`);
  for (const c of clips) {
    if (c.fresh && c.meta.generation_id && c.meta.cost_usd == null) {
      c.meta.cost_usd = await generationCost(c.meta.generation_id);
      writeFileSync(c.metaPath, JSON.stringify(c.meta, null, 1));
    }
  }
}
for (const c of clips) {
  usage.chars_total += c.meta.chars;
  usage.cost_usd_all_clips += c.meta.cost_usd ?? 0;
  if (c.fresh) usage.cost_usd_this_run += c.meta.cost_usd ?? 0;
}

// ── 앞뒤 무음 자르기 → 16 kHz mono → 이어 붙이기 ─────────────────────────
const work = path.join(os.tmpdir(), `synth-meeting-${process.pid}`);
mkdirSync(work, { recursive: true });
const rand = mulberry32(SEED);
const LEAD_MS = 500;
const TAIL_MS = 500;
const pcmParts = [];
const gold = [];
let cursor = msToSamples(LEAD_MS);
pcmParts.push(Buffer.alloc(cursor * 2));

for (let i = 0; i < utterances.length; i++) {
  const u = utterances[i];
  const trimmed = path.join(work, `${String(i).padStart(4, "0")}.wav`);
  ffmpeg(["-i", clips[i].wavPath, "-af", TRIM_FILTER, "-ar", String(SR), "-ac", "1", "-c:a", "pcm_s16le", trimmed]);
  const durS = ffprobeDuration(trimmed);
  const pcm = ffmpegPcm(trimmed);
  const samples = pcm.length / 2;
  if (Math.abs(samples / SR - durS) > 0.002) throw new Error(`길이 불일치 ${u.uid}: ffprobe ${durS}s vs ${samples / SR}s`);
  const start = cursor;
  pcmParts.push(pcm);
  cursor += samples;
  gold.push({
    uid: u.uid,
    speaker: u.speaker,
    role: u.role,
    start_ms: samplesToMs(start),
    end_ms: samplesToMs(cursor),
    text: u.text,
    ...(u.spoken_text !== u.text ? { spoken_text: u.spoken_text } : {}),
  });
  if (i < utterances.length - 1) {
    // 대부분 250–700 ms, 가끔 80–150 ms 의 빠른 맞받음
    const gapMs = rand() < 0.15 ? 80 + rand() * 70 : 250 + rand() * 450;
    const gap = msToSamples(gapMs);
    pcmParts.push(Buffer.alloc(gap * 2));
    cursor += gap;
  }
}
pcmParts.push(Buffer.alloc(msToSamples(TAIL_MS) * 2));
const pcmAll = Buffer.concat(pcmParts);
const wavPath = path.join(OUT, "meeting.wav");
writeFileSync(wavPath, wavFile(pcmAll, SR));
ffmpeg(["-i", wavPath, "-c:a", "aac", "-b:a", "64k", "-ar", String(SR), "-ac", "1", path.join(OUT, "meeting.m4a")]);
rmSync(work, { recursive: true, force: true });

const totalMs = samplesToMs(pcmAll.length / 2);
writeFileSync(path.join(OUT, "gold_segments.json"), JSON.stringify(gold, null, 1) + "\n");
writeFileSync(path.join(OUT, "transcript.json"), JSON.stringify(utterances.map(({ uid, speaker, role, text }) => ({ uid, speaker, role, text })), null, 1) + "\n");
writeFileSync(path.join(OUT, "voices.json"), JSON.stringify({
  engine: ENGINE,
  model: ENGINE === "say" ? "macos-say" : MODEL,
  seed: SEED,
  gap_rule_ms: { lead: LEAD_MS, tail: TAIL_MS, normal: [250, 700], quick_reply: [80, 150], quick_reply_prob: 0.15 },
  trim: "앞뒤 무음 제거 (-45 dB, 여유 50 ms). 발언 안의 쉼은 그대로 둔다.",
  speakers,
  duration_ms: totalMs,
}, null, 1) + "\n");
usage.cost_usd_this_run = round6(usage.cost_usd_this_run);
usage.cost_usd_all_clips = round6(usage.cost_usd_all_clips);
writeFileSync(path.join(OUT, "tts_usage.json"), JSON.stringify(usage, null, 1) + "\n");

console.log(`\n완료: ${OUT.startsWith(ROOT) ? path.relative(ROOT, OUT) : OUT}  (${(totalMs / 1000).toFixed(1)} s, 발언 ${gold.length}개)`);
console.log(`TTS 요청 ${usage.requests}건 (캐시 ${usage.cache_hits}건) · 이번 실행 비용 $${usage.cost_usd_this_run} · 클립 전체 비용 $${usage.cost_usd_all_clips}`);

// ═════════════════════════════════════════════════════════════════════════
async function synthCached(text, voice) {
  const keyObj = { v: CACHE_VERSION, engine: ENGINE, model: ENGINE === "say" ? "macos-say" : MODEL, voice, text };
  const sha = createHash("sha1").update(JSON.stringify(keyObj)).digest("hex");
  const wavPath = path.join(CACHE_DIR, `${sha}.wav`);
  const metaPath = path.join(CACHE_DIR, `${sha}.json`);
  if (existsSync(wavPath) && existsSync(metaPath)) {
    usage.cache_hits++;
    return { wavPath, metaPath, meta: JSON.parse(readFileSync(metaPath, "utf8")), fresh: false };
  }
  const meta = { ...keyObj, chars: [...text].length, created_at: new Date().toISOString() };
  if (ENGINE === "say") {
    await sayToWav(text, voice, wavPath);
  } else {
    const { pcm, rate, generationId, wrapper } = await openrouterSpeech(text, voice);
    writeFileSync(wavPath, wavFile(pcm, rate));
    meta.generation_id = generationId;
    meta.sample_rate = rate;
    if (wrapper) meta.input_wrapper = wrapper;
    usage.requests++;
    usage.chars_billed += meta.chars;
    if (generationId) usage.generation_ids.push(generationId);
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  return { wavPath, metaPath, meta, fresh: true };
}

async function openrouterSpeech(text, voice) {
  // Gemini TTS 는 response_format=pcm 만 받는다 (24 kHz s16le mono, content-type 에 rate 가 붙어 온다).
  // Gemini TTS 는 입력을 프롬프트로 읽는다. "톤은 차갑게 갑시다. 소리 지르지 말고요." 처럼 연출 지시로
  // 들리는 문장은 빈 오디오(502)가 된다. 그때는 "Say: " 를 앞에 붙여 다시 보낸다 (접두어는 읽지 않음, STT 로 확인).
  const body = { model: MODEL, input: text, voice, response_format: "pcm" };
  let wrapper = null;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e) {
      if (attempt < 4) { await sleep(2000 * attempt); continue; }
      throw new Error(`TTS 요청 실패: ${e.message}`);
    }
    if (res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      const rate = Number(/rate=(\d+)/.exec(ct)?.[1] ?? 24000);
      const pcm = Buffer.from(await res.arrayBuffer());
      if (pcm.length < 2000) throw new Error(`TTS 응답이 너무 짧습니다 (${pcm.length} bytes)`);
      return { pcm, rate, generationId: res.headers.get("x-generation-id"), wrapper };
    }
    const msg = (await res.text()).slice(0, 300);
    if (res.status === 502 && /empty audio/i.test(msg) && !wrapper) {
      wrapper = "Say: ";
      body.input = wrapper + text;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(3000 * attempt); continue; }
    throw new Error(`TTS HTTP ${res.status}: ${msg}`);
  }
}

async function generationCost(id) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${KEY}` },
      });
      if (r.ok) {
        const j = await r.json();
        const c = j?.data?.total_cost;
        if (typeof c === "number") return c;
      }
    } catch { /* 재시도 */ }
    await sleep(1500 * (attempt + 1));
  }
  return null;
}

async function sayToWav(text, voice, outPath) {
  const [name, factorStr] = voice.split("@");
  const f = Number(factorStr ?? 1);
  const raw = path.join(os.tmpdir(), `say-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  execFileSync("say", ["-v", name, "--file-format=WAVE", "--data-format=LEI16@22050", "-o", raw, text]);
  const filter = f === 1 ? "anull" : `asetrate=${Math.round(22050 * f)},aresample=24000,atempo=${(1 / f).toFixed(4)}`;
  ffmpeg(["-i", raw, "-af", filter, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outPath]);
  rmSync(raw, { force: true });
}

// ── 대본 읽기 ─────────────────────────────────────────────────────────────
function readTranscript(file) {
  const raw = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map((u) => ({ uid: u.uid, speaker: u.speaker ?? u.speaker_name, role: u.role ?? "", text: u.text ?? u.text_raw }));
    if (typeof j.transcript === "string") return parseLines(j.transcript);
    throw new Error("알 수 없는 JSON 형식입니다.");
  }
  return parseLines(raw);
}

function parseLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(U\d+)\s+\d{1,2}:\d{2}\s+(.+?)\((.+?)\):\s*(.+)$/);
    if (m) out.push({ uid: m[1], speaker: m[2].trim(), role: m[3].trim(), text: m[4].trim() });
  }
  return out;
}

/** 소리 내어 읽지 않는 지문 "(다른 콘티 보며)" 는 뺀다. 원문은 gold 의 text 에 남는다. */
function spokenText(text) {
  const t = text.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return t || text;
}

function parseVoiceMap(s) {
  const map = {};
  if (!s) return map;
  for (const pair of s.split(",")) {
    const [k, v] = pair.split("=").map((x) => x?.trim());
    if (k && v) map[k] = v;
  }
  return map;
}

// ── 오디오 도구 ───────────────────────────────────────────────────────────
function ffmpeg(a) {
  execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...a], { stdio: ["ignore", "ignore", "inherit"] });
}
function ffmpegPcm(file) {
  return execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(SR), "-"], { maxBuffer: 1 << 30 });
}
function ffprobeDuration(file) {
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}
function wavFile(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function msToSamples(ms) { return Math.round((ms * SR) / 1000); }
function samplesToMs(n) { return Math.round((n * 1000) / SR); }

// ── 기타 ──────────────────────────────────────────────────────────────────
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
async function runPool(tasks, n) {
  let next = 0;
  const worker = async () => { while (next < tasks.length) await tasks[next++](); };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function round6(x) { return Math.round(x * 1e6) / 1e6; }
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      o[k] = v;
    }
  }
  return o;
}
function loadEnvLocal() {
  const f = path.join(ROOT, ".env.local");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2].trim() && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
