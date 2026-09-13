/**
 * 해석 차이 탐지 평가: v1(팀의 기존 분석기) 대 v2(원출력 → 규칙 검사 → 문맥 검사).
 *
 *   npx tsx scripts/eval-alignment.ts [--sets a,b] [--repeats 3] [--concurrency 3] [--out fixtures/eval/results/alignment-YYYYMMDD]
 *        [--kinds v1,v2,v2_window] [--window 12]
 *
 * - v2_window: 회의 중 화면과 같은 창 단위 분석(lib/alignment/window.ts, Haiku + 판정)을 회의 끝까지 돌린 뒤의 안건을 채점한다.
 *
 * - 평가 세트: 팀 정답 2벌(SCENE 12·34) + 합성 회의(fixtures/eval/meetings). lib/eval/sets.ts
 * - v2 는 LLM 을 한 번 부르고 단계별 결과(raw·rules·full)를 모두 채점한다. 같은 호출이므로 검사 단계의 효과만 비교된다.
 * - 예측↔정답 대응은 채점 모델이 고른다(lib/eval/match.ts). v2 세 단계는 안건 key 가 같아서 대응을 한 번만 산다.
 * - 같은 입력도 결과가 흔들리므로 반복 실행해 평균과 표준편차를 적는다.
 * - 별도 DB(.data/eval.db)를 쓴다. 판정·대응 캐시가 여기에 쌓인다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

process.env.SCENENOTE_DB ??= path.join(process.cwd(), ".data", "eval.db");

type Kind = "v1" | "v2" | "v2_window";
type Arg = { sets: string[] | null; repeats: number; concurrency: number; out: string; kinds: Kind[]; window: number };
function args(): Arg {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return {
    sets: get("--sets")?.split(",") ?? null,
    repeats: Number(get("--repeats") ?? 3),
    concurrency: Number(get("--concurrency") ?? 3),
    out: get("--out") ?? `fixtures/eval/results/alignment-${stamp}`,
    kinds: (get("--kinds")?.split(",") as Kind[] | undefined) ?? ["v1", "v2"],
    window: Number(get("--window") ?? 12),
  };
}

async function main() {
  const opt = args();
  const { loadEvalSets } = await import("../lib/eval/sets");
  const { matchPredictions, score } = await import("../lib/eval/match");
  const { analyzeUtterances } = await import("../lib/alignment/analyze");
  const { analyzeDongSang } = await import("../lib/analysis/dongsangAnalyzer");
  const { runAllWindows } = await import("../lib/alignment/window");
  const { sumUsage } = await import("../lib/llm/openrouter");
  type Pred = import("../lib/eval/match").Pred;
  type Metrics = import("../lib/eval/match").Metrics;

  const sets = loadEvalSets().filter((s) => !opt.sets || opt.sets.includes(s.name));
  console.log(`세트 ${sets.map((s) => `${s.name}(${s.utts.length}발언, 정답 ${s.gold.length})`).join(", ")} · 반복 ${opt.repeats}`);

  type Row = { set: string; rep: number; variant: string; metrics: Metrics; latencyMs: number; costUsd: number | null; extra?: Record<string, unknown>; preds: Pred[] };
  const rows: Row[] = [];
  const matchCost: number[] = [];

  type Job = { set: (typeof sets)[number]; rep: number; kind: Kind };
  const jobs: Job[] = [];
  for (let rep = 1; rep <= opt.repeats; rep++) for (const set of sets) for (const kind of opt.kinds) jobs.push({ set, rep, kind });

  async function runJob(j: Job) {
    const { set, rep } = j;
    const tag = `${set.name}#${rep} ${j.kind}`;
    try {
      if (j.kind === "v2_window") {
        const t0 = Date.now();
        let firstIssueMs: number | null = null;
        const st = await runAllWindows(`evalw_${set.name}`, `evalw_${set.name}_${rep}`, set.utts, { projectTitle: set.title, sceneLine: set.sceneLine }, {
          size: opt.window,
          onWindow: (w) => {
            if (firstIssueMs === null && w.newIssues.length) firstIssueMs = Date.now() - t0;
          },
        });
        const latencyMs = Date.now() - t0;
        const preds: Pred[] = [...st.issues.values()].map((i) => ({
          pid: i.key,
          type: i.type,
          title: `${i.decision}${i.concept ? ` (${i.concept})` : ""}`,
          positions: i.positions.map((p) => ({ who: p.speaker.name ?? p.speaker.key ?? "?", meaning: p.meaning })),
          evidence: i.evidence_all,
        }));
        const m = await matchPredictions({ gold: set.gold, nonIssues: set.nonIssues, preds, utts: set.utts });
        if (m.usage?.costUsd) matchCost.push(m.usage.costUsd);
        const u = sumUsage(st.usages);
        rows.push({
          set: set.name,
          rep,
          variant: "v2_window",
          metrics: score(preds, m.matches, set.gold, set.nonIssues),
          latencyMs,
          costUsd: u.costUsd,
          extra: { windows: st.windows.length, firstIssueSec: firstIssueMs === null ? null : firstIssueMs / 1000 },
          preds,
        });
      } else if (j.kind === "v1") {
        const t0 = Date.now();
        const r = await analyzeDongSang(set.utts.map((u) => ({ uid: u.uid, speakerId: null, speakerName: u.speakerName, text: u.text })));
        const latencyMs = Date.now() - t0;
        const byUid = new Map(set.utts.map((u) => [u.uid, u]));
        let mismatch = 0,
          interps = 0,
          sameSpeakerIssues = 0;
        const preds: Pred[] = r.issues.map((i, n) => {
          const who = new Set<string>();
          for (const it of i.interpretations) {
            interps++;
            const own = it.evidenceUids.some((e) => byUid.get(e)?.speakerName === it.speakerName);
            if (!own) mismatch++;
            it.evidenceUids.forEach((e) => who.add(byUid.get(e)?.speakerName ?? "?"));
          }
          if (who.size < 2) sameSpeakerIssues++;
          return {
            pid: `v1_${n}`,
            type: "interpretation_gap",
            title: `${i.decision}${i.concept ? ` (${i.concept})` : ""}`,
            positions: i.interpretations.map((x) => ({ who: x.speakerName ?? x.speakerId ?? "?", meaning: x.meaning })),
            evidence: [...new Set(i.interpretations.flatMap((x) => x.evidenceUids))],
          };
        });
        const m = await matchPredictions({ gold: set.gold, nonIssues: set.nonIssues, preds, utts: set.utts });
        if (m.usage?.costUsd) matchCost.push(m.usage.costUsd);
        rows.push({
          set: set.name,
          rep,
          variant: "v1",
          metrics: score(preds, m.matches, set.gold, set.nonIssues),
          latencyMs,
          costUsd: null,
          extra: { agreements: r.agreements.length, speakerMismatchInterps: mismatch, interps, sameSpeakerIssues },
          preds,
        });
      } else {
        const st: {
          raw: import("../lib/alignment/schema").LlmAnalysisOutput | null;
          labels: Map<string, import("../lib/alignment/prompt").SpeakerLabel>;
          rules: import("../lib/alignment/schema").AlignmentIssueV2[];
          llmMs: number;
        } = { raw: null, labels: new Map(), rules: [], llmMs: 0 };
        const tLlm = Date.now();
        const r = await analyzeUtterances({
          meetingId: `eval_${set.name}`,
          runId: `eval_${set.name}_${rep}`,
          utts: set.utts,
          context: { projectTitle: set.title, sceneLine: set.sceneLine, projectId: null },
          onStage: (s) => {
            if (s.stage === "llm") {
              st.raw = s.raw;
              st.labels = s.labels;
              st.llmMs = Date.now() - tLlm;
            } else st.rules = s.issues;
          },
        });
        const llmMs = st.llmMs;
        const rules = st.rules;
        const byLabel = new Map([...st.labels.values()].map((l) => [l.label, l]));
        const valid = new Set(set.utts.map((u) => u.uid));
        const rawPreds: Pred[] = (st.raw?.issues ?? []).map((i) => ({
          pid: i.key,
          type: i.type,
          title: `${i.decision}${i.concept ? ` (${i.concept})` : ""}`,
          positions: i.positions.map((p) => ({ who: byLabel.get(p.speaker)?.name ?? p.speaker, meaning: p.meaning })),
          evidence: [...new Set(i.positions.flatMap((p) => p.evidence).filter((e) => valid.has(e)))],
        }));
        // 같은 key 가 두 번 나오면 assemble 과 같게 뒤에 접미사를 붙인다.
        const seenKey = new Map<string, number>();
        for (const p of rawPreds) {
          const n = seenKey.get(p.pid) ?? 0;
          seenKey.set(p.pid, n + 1);
          if (n > 0) p.pid = `${p.pid}_${n + 1}`;
        }
        const toPred = (i: import("../lib/alignment/schema").AlignmentIssueV2): Pred => ({
          pid: i.key,
          type: i.type,
          title: `${i.decision}${i.concept ? ` (${i.concept})` : ""}`,
          positions: i.positions.map((p) => ({ who: p.speaker.name ?? p.speaker.key ?? "?", meaning: p.meaning })),
          evidence: i.evidence_all,
        });
        const m = await matchPredictions({ gold: set.gold, nonIssues: set.nonIssues, preds: rawPreds, utts: set.utts });
        if (m.usage?.costUsd) matchCost.push(m.usage.costUsd);
        const rulesPreds = rules.map(toPred);
        const fullPreds = r.issues.map(toPred);
        const extra = { stats: r.stats, agreements: r.agreements.length, conditionalAgreements: r.agreements.filter((a) => a.condition).length };
        rows.push({ set: set.name, rep, variant: "v2_raw", metrics: score(rawPreds, m.matches, set.gold, set.nonIssues), latencyMs: llmMs, costUsd: null, preds: rawPreds });
        rows.push({ set: set.name, rep, variant: "v2_rules", metrics: score(rulesPreds, m.matches, set.gold, set.nonIssues), latencyMs: llmMs, costUsd: null, preds: rulesPreds });
        rows.push({ set: set.name, rep, variant: "v2_full", metrics: score(fullPreds, m.matches, set.gold, set.nonIssues), latencyMs: r.latencyMs, costUsd: r.usage.costUsd, extra, preds: fullPreds });
      }
      console.log(`  ✓ ${tag}`);
    } catch (e) {
      console.log(`  ✗ ${tag}: ${(e as Error).message}`);
      rows.push({ set: set.name, rep, variant: j.kind === "v1" ? "v1" : j.kind === "v2_window" ? "v2_window" : "v2_full", metrics: score([], new Map(), set.gold, set.nonIssues), latencyMs: 0, costUsd: null, extra: { error: (e as Error).message }, preds: [] });
    }
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(opt.concurrency, jobs.length) }, async () => {
      while (next < jobs.length) await runJob(jobs[next++]);
    }),
  );

  // ── 집계 ────────────────────────────────────────────────────────────────
  const variants = ["v1", "v2_raw", "v2_rules", "v2_full", "v2_window"];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sd = (xs: number[]) => {
    const m = mean(xs);
    return m === null || xs.length < 2 ? null : Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  };
  const nums = (rs: Row[], f: (m: Metrics) => number | null) => rs.map((r) => f(r.metrics)).filter((x): x is number => x !== null);
  const summary: Record<string, Record<string, unknown>> = {};
  for (const set of [...sets.map((s) => s.name), "ALL"]) {
    for (const v of variants) {
      const rs = rows.filter((r) => (set === "ALL" || r.set === set) && r.variant === v && !r.extra?.error);
      if (!rs.length) continue;
      const tp = rs.reduce((a, r) => a + r.metrics.tp, 0);
      const pr = rs.reduce((a, r) => a + r.metrics.preds, 0);
      const gd = rs.reduce((a, r) => a + r.metrics.gold, 0);
      summary[`${set}|${v}`] = {
        set,
        variant: v,
        runs: rs.length,
        precision: set === "ALL" ? (pr ? tp / pr : null) : mean(nums(rs, (m) => m.precision)),
        precisionSd: sd(nums(rs, (m) => m.precision)),
        recall: set === "ALL" ? (gd ? tp / gd : null) : mean(nums(rs, (m) => m.recall)),
        recallSd: sd(nums(rs, (m) => m.recall)),
        preds: mean(rs.map((r) => r.metrics.preds)),
        falseEscalations: mean(rs.map((r) => r.metrics.falseEscalations)),
        duplicates: mean(rs.map((r) => r.metrics.duplicates)),
        evidencePrecision: mean(nums(rs, (m) => m.evidencePrecision)),
        evidenceRecall: mean(nums(rs, (m) => m.evidenceRecall)),
        typeAccuracy: mean(nums(rs, (m) => m.typeAccuracy)),
        latencySec: mean(rs.map((r) => r.latencyMs / 1000)),
        costUsd: mean(rs.map((r) => r.costUsd).filter((x): x is number => x !== null)),
        missed: [...new Set(rs.flatMap((r) => r.metrics.missedKeys))],
        escalated: [...new Set(rs.flatMap((r) => r.metrics.escalatedKeys))],
      };
    }
  }

  mkdirSync(path.dirname(opt.out), { recursive: true });
  writeFileSync(`${opt.out}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), options: opt, sets: sets.map((s) => ({ name: s.name, source: s.source, reviewed: s.reviewed, utterances: s.utts.length, gold: s.gold.length, nonIssues: s.nonIssues.length })), summary, rows, matchCostUsd: matchCost.reduce((a, b) => a + b, 0) }, null, 2));

  const f = (x: unknown, d = 2) => (typeof x === "number" ? x.toFixed(d) : "-");
  const pm = (m: unknown, s: unknown) => (typeof m === "number" ? `${m.toFixed(2)}${typeof s === "number" ? ` ± ${s.toFixed(2)}` : ""}` : "-");
  const lines = [
    `# 해석 차이 탐지 평가 (${new Date().toISOString().slice(0, 10)})`,
    "",
    `반복 ${opt.repeats}회. 정밀도·재현율은 세트별로 반복 평균 ± 표준편차, ALL 은 전체 합산(micro). 과잉 경보는 정답이 "안건 아님"으로 둔 대상을 안건으로 올린 수(반복 평균).`,
    "",
    "| 세트 | 분석기 | 예측 수 | 정밀도 | 재현율 | 과잉 경보 | 중복 | 근거 정밀도 | 근거 재현율 | 유형 일치 | 시간(초) | 비용($) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...Object.values(summary).map(
      (s: any) =>
        `| ${s.set} | ${s.variant} | ${f(s.preds, 1)} | ${pm(s.precision, s.precisionSd)} | ${pm(s.recall, s.recallSd)} | ${f(s.falseEscalations, 1)} | ${f(s.duplicates, 1)} | ${f(s.evidencePrecision)} | ${f(s.evidenceRecall)} | ${f(s.typeAccuracy)} | ${f(s.latencySec, 0)} | ${f(s.costUsd)} |`,
    ),
    "",
    "## 놓친 정답·과잉 경보 (반복 중 한 번이라도)",
    ...Object.values(summary)
      .filter((s: any) => s.set !== "ALL")
      .map((s: any) => `- ${s.set} / ${s.variant}: 놓침 ${s.missed.join(", ") || "없음"} · 과잉 경보 ${s.escalated.join(", ") || "없음"}`),
    "",
    `채점 모델 비용 합계 $${matchCost.reduce((a, b) => a + b, 0).toFixed(2)}`,
  ];
  writeFileSync(`${opt.out}.md`, "﻿" + lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
