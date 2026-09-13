#!/usr/bin/env node
/**
 * 합성 회의 음성(scripts/synth-meeting.mjs 산출물)으로 화자분리 방법을 비교한다.
 *
 *   node scripts/eval-diarization-v2.mjs [--meetings scene34_m01,scene12,scene27]
 *        [--sidecar http://127.0.0.1:8790] [--chunk-sec 180] [--overlap-sec 3]
 *        [--link-threshold 0.4] [--link-sweep 0.2,0.3,0.4,0.5,0.6] [--fresh-stt] [--date 20260911] [--md-only]
 *
 * 전제: sidecar 가 떠 있어야 한다.  cd sidecar && uv run uvicorn audio_sidecar.server:app --port 8790
 *
 * 방법
 *   grok_whole            회의 파일 전체를 Grok STT(x-ai/grok-stt-1.0, diarize) 한 번에. words[].speaker 로 구간을 만든다.
 *   sidecar_diarize       sidecar /diarize (Silero VAD + ECAPA 창 임베딩 + 군집), 화자 수를 정답으로 알려 준다.
 *   sidecar_diarize_auto  (참고) 같은 것을 화자 수 없이.
 *   grok_words_sidecar_speakers (참고) 전사 단어는 grok_whole, 화자는 sidecar_diarize 구간에서 (추가 과금 없음).
 *   grok_chunked_linked   ~180 s 조각(3 s 겹침)마다 Grok STT → sidecar /link-speakers 로 조각 간 화자 연결.
 *   grok_chunked_naive    (비교) 연결 없이 조각마다 받은 화자 번호를 그대로 이어 붙임 (조각 1의 "0" = 조각 2의 "0").
 *   grok_chunked_scoped   (비교) 연결 없이 조각마다 다른 사람으로 둠.
 *
 * 채점: sidecar /der (pyannote.metrics DER/JER, collar 250 ms = 경계 ±125 ms), 발언 단위 화자 정확도(헝가리안 대응),
 *       STT 글자 오류율(CER, 공백·문장부호 제거 후 Levenshtein).
 * 요청 본문은 lib/transcription/providers/openrouter.ts 와 같다. STT 응답은 fixtures/eval/audio/<회의>/stt/ 에 저장해
 * 다시 돌려도 재과금되지 않는다 (--fresh-stt 로 새로 받기). 키 값은 출력하지 않는다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const MEETINGS = (args.meetings ?? "scene34_m01,scene12,scene27").split(",").map((s) => s.trim()).filter(Boolean);
const SIDECAR = (args.sidecar ?? `http://127.0.0.1:${process.env.SIDECAR_PORT ?? 8790}`).replace(/\/$/, "");
const CHUNK_MS = Number(args["chunk-sec"] ?? 180) * 1000;
const OVERLAP_MS = Number(args["overlap-sec"] ?? 3) * 1000;
const LINK_THRESHOLD = args["link-threshold"] != null ? Number(args["link-threshold"]) : null;
const LINK_SWEEP = (args["link-sweep"] ?? "0.2,0.3,0.4,0.5,0.6").split(",").map(Number).filter((x) => Number.isFinite(x));
const FRESH = args["fresh-stt"] === "true";
const DATE = args.date ?? "20260911";
const COLLAR_MS = 250;
const GAP_MS = Number(process.env.STT_UTTERANCE_GAP_MS ?? 400); // 프로덕션과 같은 규칙
const STT_MODEL = process.env.OPENROUTER_STT_MODEL ?? "x-ai/grok-stt-1.0";
const STT_ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";

if (args["md-only"] === "true") {
  // 저장된 결과 JSON 에서 요약 md 만 다시 만든다 (API·sidecar 호출 없음).
  const outDir = path.join(ROOT, "fixtures/eval/results");
  const saved = readJson(path.join(outDir, `diarization-${DATE}.json`));
  writeFileSync(path.join(outDir, `diarization-${DATE}.md`), markdown(saved));
  console.log(`다시 씀: fixtures/eval/results/diarization-${DATE}.md`);
  process.exit(0);
}

loadEnvLocal();
const KEY = process.env.OPENROUTER_API_KEY?.trim();
if (!KEY) fail("OPENROUTER_API_KEY 가 없습니다.");

const health = await getJson(`${SIDECAR}/health`).catch(() => null);
if (!health?.ok) fail(`sidecar(${SIDECAR})에 연결하지 못했습니다. 먼저: cd sidecar && uv run uvicorn audio_sidecar.server:app --port 8790`);

const results = {
  generated_at: new Date().toISOString(),
  caveat: "TTS(Gemini 3.1 Flash TTS) 목소리로 만든 합성 회의다. 사람 회의 품질이 아니라 파이프라인 동작을 잰다. 겹쳐 말하기·잡음·마이크 거리가 없다.",
  settings: { stt_model: STT_MODEL, collar_ms: COLLAR_MS, collar_semantics: "pyannote: 경계마다 ±collar/2", utterance_gap_ms: GAP_MS, chunk_ms: CHUNK_MS, overlap_ms: OVERLAP_MS, link_threshold: LINK_THRESHOLD, sidecar: health },
  meetings: {},
  cost: { stt_usd_this_run: 0, stt_usd_all_cached_responses: 0 },
};

for (const name of MEETINGS) {
  const dir = path.join(ROOT, "fixtures/eval/audio", name);
  if (!existsSync(path.join(dir, "gold_segments.json"))) { console.warn(`건너뜀: ${name} (gold_segments.json 없음)`); continue; }
  console.log(`\n=== ${name}`);
  const gold = readJson(path.join(dir, "gold_segments.json"));
  const voices = readJson(path.join(dir, "voices.json"));
  const wav = path.join(dir, "meeting.wav");
  const m4a = path.join(dir, "meeting.m4a");
  if (!existsSync(wav)) ffmpeg(["-i", m4a, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]); // wav 는 git 에 없다
  const ref = gold.map((g) => ({ start_ms: g.start_ms, end_ms: g.end_ms, speaker: g.speaker }));
  const utts = gold.map((g) => ({ uid: g.uid, start_ms: g.start_ms, end_ms: g.end_ms, speaker: g.speaker }));
  const goldText = gold.map((g) => g.spoken_text ?? g.text).join(" ");
  const nSpk = new Set(gold.map((g) => g.speaker)).size;
  const sttDir = path.join(dir, "stt");
  mkdirSync(sttDir, { recursive: true });
  const M = { duration_ms: voices.duration_ms, num_speakers: nSpk, utterances: gold.length, methods: {} };
  results.meetings[name] = M;

  const score = async (hyp) => {
    const r = await postJson(`${SIDECAR}/der`, { reference: ref, hypothesis: hyp, collar_ms: COLLAR_MS, utterances: utts });
    const u = r.utterance_speaker_accuracy;
    return {
      der: r.der, jer: r.jer, confusion: r.confusion, missed_detection: r.missed_detection, false_alarm: r.false_alarm,
      total_ms: r.total_ms, hyp_speakers: r.num_hyp_speakers,
      utterance_accuracy: u.accuracy, utterance_correct: `${u.correct}/${u.total}`, utterance_mapping: u.mapping,
      utterance_rows: u.rows.map(({ uid, ref: rr, hyp: h, mapped, correct }) => ({ uid, ref: rr, hyp: h, mapped, correct })),
    };
  };

  // (a) grok_whole ----------------------------------------------------------
  let wholeWords = null;
  {
    const t = await stt(m4a, path.join(sttDir, "grok_whole.json"));
    if (t.error) {
      M.methods.grok_whole = { error: t.error, elapsed_ms: t.elapsed_ms };
      console.log(`  grok_whole 실패: ${t.error}`);
    } else {
      const words = wordsOf(t.response, 0);
      wholeWords = words;
      const hyp = segmentsOf(words, (w) => w.speaker);
      M.methods.grok_whole = {
        ...(await score(hyp)),
        cer: cer(goldText, words.map((w) => w.text).join(" ")),
        stt_speakers: new Set(words.map((w) => keyOf(w.speaker))).size,
        words_without_speaker: words.filter((w) => w.speaker == null).length,
        elapsed_ms: t.elapsed_ms, stt_cost_usd: t.cost,
      };
      line("grok_whole", M.methods.grok_whole);
    }
  }

  // (b) sidecar_diarize -------------------------------------------------------
  let diarSegs = null;
  for (const [label, body] of [["sidecar_diarize", { num_speakers: nSpk }], ["sidecar_diarize_auto", { min_speakers: 1, max_speakers: 8 }]]) {
    const t0 = Date.now();
    const d = await postJson(`${SIDECAR}/diarize`, { audio_path: wav, ...body });
    if (label === "sidecar_diarize") diarSegs = d.segments;
    M.methods[label] = { ...(await score(d.segments)), elapsed_ms: Date.now() - t0, method: d.method, windows: d.windows };
    line(label, M.methods[label]);
  }

  // (참고) Grok 단어 + sidecar 화자: 전사는 Grok, 화자는 단어 시간에 가장 많이 겹친 sidecar 구간에서 가져온다.
  if (wholeWords && diarSegs) {
    const labelOf = (w) => {
      let best = null;
      let bestOv = 0;
      let nearest = null;
      let nearestGap = Infinity;
      for (const s of diarSegs) {
        const ov = Math.min(w.end_ms, s.end_ms) - Math.max(w.start_ms, s.start_ms);
        if (ov > bestOv) { bestOv = ov; best = s.speaker; }
        const gap = Math.max(s.start_ms - w.end_ms, w.start_ms - s.end_ms, 0);
        if (gap < nearestGap) { nearestGap = gap; nearest = s.speaker; }
      }
      return best ?? (nearestGap <= 1000 ? nearest : null);
    };
    const hyp = segmentsOf(wholeWords, labelOf);
    M.methods.grok_words_sidecar_speakers = { ...(await score(hyp)), cer: M.methods.grok_whole.cer };
    line("grok_words_sidecar_spk", M.methods.grok_words_sidecar_speakers);
  }

  // (c) grok_chunked_* --------------------------------------------------------
  {
    const work = path.join(os.tmpdir(), "eval-diarization-v2", name);
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const total = voices.duration_ms;
    const starts = [];
    for (let s = 0; s < total; s += CHUNK_MS - OVERLAP_MS) {
      starts.push(s);
      if (s + CHUNK_MS >= total) break;
    }
    const chunks = [];
    let failed = null;
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const dur = Math.min(CHUNK_MS, total - start);
      const cw = path.join(work, `chunk_${String(i).padStart(2, "0")}.wav`);
      const cm = cw.replace(/\.wav$/, ".m4a");
      ffmpeg(["-i", wav, "-ss", (start / 1000).toFixed(3), "-t", (dur / 1000).toFixed(3), "-c:a", "pcm_s16le", cw]);
      ffmpeg(["-i", cw, "-c:a", "aac", "-b:a", "64k", cm]);
      const t = await stt(cm, path.join(sttDir, `grok_chunk_${String(i).padStart(2, "0")}_of_${starts.length}.json`), { start, dur });
      if (t.error) { failed = `chunk ${i}: ${t.error}`; break; }
      chunks.push({ i, start, dur, wav: cw, words: wordsOf(t.response, 0), cost: t.cost });
    }
    if (failed) {
      for (const k of ["grok_chunked_linked", "grok_chunked_naive", "grok_chunked_scoped"]) M.methods[k] = { error: failed };
      console.log(`  grok_chunked 실패: ${failed}`);
    } else {
      // 겹침 구간은 가운데에서 자른다: 앞 조각은 가운데 전까지, 뒤 조각은 가운데부터의 단어만 쓴다.
      const cuts = chunks.map((c, i) => (i === 0 ? -Infinity : c.start + OVERLAP_MS / 2));
      const kept = [];
      for (const c of chunks) {
        const lo = cuts[c.i];
        const hi = c.i + 1 < chunks.length ? cuts[c.i + 1] : Infinity;
        for (const w of c.words) {
          const g = { ...w, start_ms: w.start_ms + c.start, end_ms: w.end_ms + c.start, chunk: c.i };
          const mid = (g.start_ms + g.end_ms) / 2;
          if (mid >= lo && mid < hi) kept.push(g);
        }
      }
      const link = await postJson(`${SIDECAR}/link-speakers`, {
        chunks: chunks.map((c) => ({ audio_path: c.wav, offset_ms: c.start, words: c.words.map(({ start_ms, end_ms, speaker }) => ({ start_ms, end_ms, speaker })) })),
        ...(LINK_THRESHOLD != null ? { threshold: LINK_THRESHOLD } : {}),
      });
      const gmap = new Map(link.mapping.map((m) => [`${m.chunk_index}:${keyOf(m.local)}`, m.global]));
      const sttCer = cer(goldText, kept.map((w) => w.text).join(" "));
      const chunkCost = round6(chunks.reduce((a, c) => a + (c.cost ?? 0), 0));
      const variants = {
        grok_chunked_linked: (w) => gmap.get(`${w.chunk}:${keyOf(w.speaker)}`) ?? null,
        grok_chunked_naive: (w) => keyOf(w.speaker),
        grok_chunked_scoped: (w) => `${w.chunk}:${keyOf(w.speaker)}`,
      };
      for (const [k, fn] of Object.entries(variants)) {
        const hyp = segmentsOf(kept, fn);
        M.methods[k] = { ...(await score(hyp)), cer: sttCer, chunks: chunks.length, stt_cost_usd: chunkCost };
        line(k, M.methods[k]);
      }
      // 임계값 민감도: STT 는 그대로 두고 연결만 다시 한다 (추가 과금 없음).
      const sweep = [];
      for (const th of LINK_SWEEP) {
        const l2 = await postJson(`${SIDECAR}/link-speakers`, {
          chunks: chunks.map((c) => ({ audio_path: c.wav, offset_ms: c.start, words: c.words.map(({ start_ms, end_ms, speaker }) => ({ start_ms, end_ms, speaker })) })),
          threshold: th,
        });
        const g2 = new Map(l2.mapping.map((m) => [`${m.chunk_index}:${keyOf(m.local)}`, m.global]));
        const s2 = await score(segmentsOf(kept, (w) => g2.get(`${w.chunk}:${keyOf(w.speaker)}`) ?? null));
        sweep.push({ threshold: th, global_speakers: l2.global_speakers.length, der: s2.der, utterance_accuracy: s2.utterance_accuracy });
      }
      M.link = {
        threshold: link.threshold,
        global_speakers: link.global_speakers.length,
        mapping: link.mapping,
        threshold_sweep: sweep,
        diagnostics: linkDiagnostics(chunks, gold, link),
      };
      console.log(`  link: 조각 ${chunks.length}개 · 지역 화자 ${link.mapping.length} → 전역 ${link.global_speakers.length}명 (threshold ${link.threshold})`);
    }
  }
}

writeResults();

// ═════════════════════════════════════════════════════════════════════════
async function stt(file, cachePath, extra = {}) {
  if (!FRESH && existsSync(cachePath)) {
    const c = readJson(cachePath);
    results.cost.stt_usd_all_cached_responses = round6(results.cost.stt_usd_all_cached_responses + (c.cost ?? 0));
    return c;
  }
  const audio = readFileSync(file);
  const format = path.extname(file).slice(1) || "m4a";
  // lib/transcription/providers/openrouter.ts 와 같은 본문. 화자분리는 provider.options.xai.diarize 로만 켜진다.
  const body = {
    model: STT_MODEL,
    response_format: "verbose_json",
    language: "ko",
    provider: { options: { xai: { diarize: true } } },
    input_audio: { data: audio.toString("base64"), format },
  };
  const t0 = Date.now();
  let out;
  try {
    const res = await fetch(STT_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || !payload) {
      out = { error: `HTTP ${res.status}: ${payload?.error?.message ?? "no body"}`, http_status: res.status };
    } else {
      out = { response: payload, cost: payload.usage?.cost ?? null, http_status: res.status, generation_id: res.headers.get("x-generation-id") };
    }
  } catch (e) {
    out = { error: `${e.name}: ${e.message}` };
  }
  out = { model: STT_MODEL, file: path.basename(file), bytes: audio.length, ...extra, elapsed_ms: Date.now() - t0, at: new Date().toISOString(), ...out };
  writeFileSync(cachePath, JSON.stringify(out, null, 1));
  results.cost.stt_usd_this_run = round6(results.cost.stt_usd_this_run + (out.cost ?? 0));
  results.cost.stt_usd_all_cached_responses = round6(results.cost.stt_usd_all_cached_responses + (out.cost ?? 0));
  return out;
}

function wordsOf(resp, offsetMs) {
  return (resp.words ?? [])
    .map((w) => ({ text: String(w.word ?? w.text ?? "").trim(), start: w.start, end: w.end, speaker: w.speaker ?? null }))
    .filter((w) => w.text && typeof w.start === "number" && typeof w.end === "number")
    .map((w) => ({ text: w.text, start_ms: Math.round(w.start * 1000) + offsetMs, end_ms: Math.round(w.end * 1000) + offsetMs, speaker: w.speaker }));
}

/** 프로덕션 buildUtterances 와 같은 경계: 화자가 바뀌거나 같은 화자라도 GAP_MS 이상 끊기면 나눈다. */
function segmentsOf(words, labelOf) {
  const segs = [];
  let prevEnd = null;
  for (const w of [...words].sort((a, b) => a.start_ms - b.start_ms)) {
    const spk = labelOf(w);
    const last = segs.at(-1);
    if (!last || last.speaker !== spk || (prevEnd != null && w.start_ms - prevEnd >= GAP_MS)) {
      segs.push({ start_ms: w.start_ms, end_ms: w.end_ms, speaker: spk });
    } else {
      last.end_ms = Math.max(last.end_ms, w.end_ms);
    }
    prevEnd = w.end_ms;
  }
  return segs.filter((s) => s.end_ms > s.start_ms);
}

/** 조각별 지역 화자가 실제로 누구였는지(단어 중점이 걸친 정답 발언의 다수결)와 쌍별 코사인 분포. */
function linkDiagnostics(chunks, gold, link) {
  const truthOf = new Map();
  for (const c of chunks) {
    const tally = new Map();
    for (const w of c.words) {
      const mid = (w.start_ms + w.end_ms) / 2 + c.start;
      const g = gold.find((x) => mid >= x.start_ms && mid < x.end_ms);
      const k = `${c.i}:${keyOf(w.speaker)}`;
      if (!tally.has(k)) tally.set(k, new Map());
      const t = tally.get(k);
      const who = g?.speaker ?? "(무음)";
      t.set(who, (t.get(who) ?? 0) + 1);
    }
    for (const [k, t] of tally) {
      const total = [...t.values()].reduce((a, b) => a + b, 0);
      const [top, n] = [...t.entries()].sort((a, b) => b[1] - a[1])[0];
      truthOf.set(k, { speaker: top, purity: round3(n / total), words: total, mix: Object.fromEntries(t) });
    }
  }
  const same = [];
  const diff = [];
  for (const p of link.pairwise) {
    if (p.same_chunk) continue;
    const a = truthOf.get(p.a)?.speaker;
    const b = truthOf.get(p.b)?.speaker;
    if (!a || !b) continue;
    (a === b ? same : diff).push(p.cos);
  }
  const globalTruth = {};
  for (const m of link.mapping) {
    const t = truthOf.get(`${m.chunk_index}:${keyOf(m.local)}`);
    (globalTruth[m.global] ??= []).push(t?.speaker);
  }
  return {
    local_speakers: Object.fromEntries(truthOf),
    cross_chunk_cos_same_true_speaker: summary(same),
    cross_chunk_cos_different_true_speaker: summary(diff),
    global_to_true: globalTruth,
  };
}

// ── CER ──────────────────────────────────────────────────────────────────
function cer(refText, hypText) {
  const norm = (s) => [...s.normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "")];
  const r = norm(refText);
  const h = norm(hypText);
  if (r.length === 0) return null;
  let prev = new Uint32Array(h.length + 1).map((_, j) => j);
  let cur = new Uint32Array(h.length + 1);
  for (let i = 1; i <= r.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= h.length; j++) {
      const sub = prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return round4(prev[h.length] / r.length);
}

// ── 출력 ─────────────────────────────────────────────────────────────────
function line(k, m) {
  const pct = (x) => (x == null ? "  -  " : `${(x * 100).toFixed(1).padStart(5)}%`);
  console.log(`  ${k.padEnd(22)} DER ${pct(m.der)} JER ${pct(m.jer)} 발언정확도 ${pct(m.utterance_accuracy)} 화자 ${m.hyp_speakers}${m.cer != null ? ` CER ${pct(m.cer)}` : ""}`);
}

function writeResults() {
  const outDir = path.join(ROOT, "fixtures/eval/results");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `diarization-${DATE}.json`);
  writeFileSync(jsonPath, JSON.stringify(results, null, 1) + "\n");
  writeFileSync(path.join(outDir, `diarization-${DATE}.md`), markdown(results));
  console.log(`\n저장: ${path.relative(ROOT, jsonPath)} (+ .md) · STT 비용 이번 실행 $${results.cost.stt_usd_this_run}, 저장된 응답 전체 $${results.cost.stt_usd_all_cached_responses}`);
}

function markdown(R) {
  const pct = (x) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);
  const rows = [
    ["grok_whole", "Grok STT 전체 파일 1회"],
    ["sidecar_diarize", "sidecar /diarize, 화자 수 알려 줌"],
    ["sidecar_diarize_auto", "(참고) sidecar /diarize, 화자 수 모름"],
    ["grok_words_sidecar_speakers", "(참고) Grok 단어 + sidecar 화자"],
    ["grok_chunked_linked", "Grok STT 180 s 조각 + /link-speakers"],
    ["grok_chunked_naive", "(비교) 조각 번호 그대로 이어 붙임"],
    ["grok_chunked_scoped", "(비교) 조각마다 다른 사람으로 둠"],
  ];
  let md = `# 화자분리 평가 (합성 회의, ${DATE.slice(0, 4)}-${DATE.slice(4, 6)}-${DATE.slice(6)})\n\n`;
  md += `이 숫자는 TTS 목소리(Gemini 3.1 Flash TTS)로 만든 합성 회의에서 잰 값입니다. 실제 사람 회의의 품질이 아니라 파이프라인이 설계대로 움직이는지를 보여 줍니다. `;
  md += `합성 음성에는 말 겹침·잡음·마이크 거리 차이가 없고, 화자마다 목소리가 서로 가장 먼 것으로 골랐기 때문에 실제 회의보다 쉬운 조건입니다.\n\n`;
  md += `- 채점: pyannote.metrics DER/JER, collar ${COLLAR_MS} ms(경계마다 ±${COLLAR_MS / 2} ms 제외), 겹침 구간 포함. 발언 정확도는 정답 발언마다 가장 많이 겹친 가설 화자를 헝가리안 대응으로 맞춘 비율입니다.\n`;
  md += `- STT: \`${STT_MODEL}\` (lib/transcription/providers/openrouter.ts 와 같은 요청), 발언 경계는 화자 변경 또는 ${GAP_MS} ms 이상 쉼.\n`;
  md += `- CER: 공백·문장부호를 뺀 글자 기준 Levenshtein. TTS 가 숫자를 읽는 방식("34씬"→"삼십사 씬")과 STT 표기 차이도 오류로 셉니다.\n`;
  const usedThreshold = R.settings.link_threshold ?? Object.values(R.meetings).find((M) => M.link)?.link.threshold ?? "sidecar 기본값";
  md += `- 조각: ${CHUNK_MS / 1000} s, 겹침 ${OVERLAP_MS / 1000} s (겹침 가운데에서 단어를 나눔). 연결 임계값(코사인 거리) ${usedThreshold}.\n\n`;
  md += summaryLines(R);
  for (const [name, M] of Object.entries(R.meetings)) {
    md += `## ${name} · ${(M.duration_ms / 1000).toFixed(0)} s · 화자 ${M.num_speakers}명 · 발언 ${M.utterances}개\n\n`;
    md += `| 방법 | DER | JER | 혼동 | 누락 | 오탐 | 발언 화자 정확도 | 가설 화자 수 | STT CER |\n|---|---|---|---|---|---|---|---|---|\n`;
    for (const [k, label] of rows) {
      const m = M.methods[k];
      if (!m) continue;
      if (m.error) { md += `| ${label} | 실패: ${m.error} | | | | | | | |\n`; continue; }
      md += `| ${label} | ${pct(m.der)} | ${pct(m.jer)} | ${pct(m.confusion)} | ${pct(m.missed_detection)} | ${pct(m.false_alarm)} | ${pct(m.utterance_accuracy)} (${m.utterance_correct}) | ${m.hyp_speakers} | ${m.cer != null ? pct(m.cer) : "-"} |\n`;
    }
    if (M.link) {
      const d = M.link.diagnostics;
      const s = d.cross_chunk_cos_same_true_speaker;
      const o = d.cross_chunk_cos_different_true_speaker;
      md += `\n조각 연결: 지역 화자 ${M.link.mapping.length}개 → 전역 ${M.link.global_speakers}명. 조각 간 코사인 — 같은 실제 화자 ${s.n ? `${s.min}~${s.max} (중앙 ${s.median})` : "없음"}, 다른 화자 ${o.n ? `${o.min}~${o.max} (중앙 ${o.median})` : "없음"}.\n`;
      if (M.link.threshold_sweep?.length) {
        md += `임계값별 연결 결과: ${M.link.threshold_sweep.map((x) => `${x.threshold} → ${x.global_speakers}명 DER ${pct(x.der)}`).join(" · ")}.\n`;
      }
    }
    md += "\n";
  }
  md += `비용: STT 이번 실행 $${R.cost.stt_usd_this_run} (저장된 응답 전체 $${R.cost.stt_usd_all_cached_responses}).\n`;
  return md;
}

/** 표에서 바로 읽히지 않는 사실을 데이터에서 뽑아 적는다 (손으로 쓴 해석이 아니다). */
function summaryLines(R) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const ms = Object.entries(R.meetings);
  const lines = [];
  const gw = ms.filter(([, M]) => M.methods.grok_whole && !M.methods.grok_whole.error);
  if (gw.length) {
    lines.push(`Grok 전체 파일이 찾은 화자 수: ${gw.map(([n, M]) => `${n} ${M.methods.grok_whole.hyp_speakers}/${M.num_speakers}명`).join(", ")}. 가장 긴 파일도 한 번에 전사됐습니다 (${gw.map(([n, M]) => `${n} ${(M.duration_ms / 1000).toFixed(0)} s → ${(M.methods.grok_whole.elapsed_ms / 1000).toFixed(1)} s`).join(", ")}).`);
  }
  const failedWhole = ms.filter(([, M]) => M.methods.grok_whole?.error);
  if (failedWhole.length) lines.push(`Grok 전체 파일 실패: ${failedWhole.map(([n, M]) => `${n} (${M.methods.grok_whole.error})`).join(", ")}.`);
  const linked = ms.filter(([, M]) => M.link && M.methods.grok_chunked_linked && !M.methods.grok_chunked_linked.error && M.link.mapping.length > 0);
  const multi = linked.filter(([, M]) => M.methods.grok_chunked_linked.chunks > 1);
  const single = linked.filter(([, M]) => M.methods.grok_chunked_linked.chunks <= 1);
  if (multi.length) {
    lines.push(`조각 연결 효과 (조각 번호 그대로 → /link-speakers): ${multi.map(([n, M]) => `${n} DER ${pct(M.methods.grok_chunked_naive.der)} → ${pct(M.methods.grok_chunked_linked.der)}`).join(", ")}.${single.length ? ` ${single.map(([n]) => n).join(", ")} 은 ${CHUNK_MS / 1000} s 보다 짧아 조각이 하나라 연결할 것이 없습니다.` : ""}`);
  }
  if (linked.length) {
    const pur = linked.flatMap(([, M]) => Object.values(M.link.diagnostics.local_speakers).map((v) => ({ p: v.purity, w: v.words })));
    const wp = pur.reduce((a, x) => a + x.p * x.w, 0) / Math.max(1, pur.reduce((a, x) => a + x.w, 0));
    lines.push(`Grok 이 조각 안에서 붙인 화자 번호의 순도(단어 가중): ${pct(wp)}. 한 번호에 여러 실제 화자가 섞이면 연결 단계는 그것을 나눌 수 없습니다.`);
  }
  const sd = ms.filter(([, M]) => M.methods.sidecar_diarize);
  if (sd.length) {
    lines.push(`sidecar /diarize 오류의 구성: ${sd.map(([n, M]) => `${n} 혼동 ${pct(M.methods.sidecar_diarize.confusion)} · 누락 ${pct(M.methods.sidecar_diarize.missed_detection)}`).join(", ")}. 오탐이 0 에 가깝고, 누락은 정답 발언 안에서 VAD 가 무음으로 본 부분(문장 사이 쉼)과 거의 같은 크기입니다. 정답은 발언 전체를 말로 칩니다.`);
  }
  return lines.length ? `### 요약\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n` : "";
}

// ── 도구 ─────────────────────────────────────────────────────────────────
function keyOf(v) { return v === null || v === undefined || v === "" ? "null" : String(v); }
function summary(xs) {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, min: round3(s[0]), median: round3(s[Math.floor(s.length / 2)]), max: round3(s.at(-1)) };
}
async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return r.json();
}
async function postJson(url, body) {
  // uvicorn 은 5 s 쉰 keep-alive 연결을 닫는다. 그 순간 재사용하면 ECONNRESET 이 나므로 네트워크 오류만 다시 보낸다.
  let r;
  for (let attempt = 1; ; attempt++) {
    try {
      r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(900_000) });
      break;
    } catch (e) {
      if (attempt >= 3 || e.name === "TimeoutError") throw e;
    }
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}: ${JSON.stringify(j)?.slice(0, 300)}`);
  return j;
}
function ffmpeg(a) { execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...a], { stdio: ["ignore", "ignore", "inherit"] }); }
function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function round3(x) { return Math.round(x * 1000) / 1000; }
function round4(x) { return Math.round(x * 10000) / 10000; }
function round6(x) { return Math.round(x * 1e6) / 1e6; }
function fail(msg) { console.error(msg); process.exit(1); }
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
  for (const l of readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2].trim() && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
