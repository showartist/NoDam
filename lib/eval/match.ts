/**
 * 예측 안건 ↔ 정답 안건 대응.
 *
 * 분석기마다 안건 이름이 다르므로 문자열로는 맞출 수 없다. 채점 모델에 정답 목록(안건 + 안건 아님)과
 * 예측 목록을 주고, 예측마다 어느 정답을 가리키는지(없으면 none) 고르게 한다. 근거 발언 원문도 함께 준다.
 * 결과는 llm_cache 에 입력 해시로 남겨, 같은 예측을 다시 채점하지 않는다.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, now } from "../db";
import { chatJson, type Usage } from "../llm/openrouter";
import type { MeetingUtterance } from "../alignment/store";
import type { GoldIssue, GoldNonIssue } from "./sets";

export type Pred = { pid: string; type: string | null; title: string; positions: { who: string; meaning: string }[]; evidence: string[] };

const MatchOut = z.object({
  matches: z.array(
    z.object({
      pid: z.string(),
      key: z.string().describe("정답 key 또는 안건 아님 key. 해당 없으면 none"),
      fit: z.enum(["clear", "partial"]).describe("clear: 같은 안건. partial: 같은 대상을 다루지만 초점이 일부만 겹침"),
    }),
  ),
});

const SYS = `당신은 회의 분석 결과를 정답과 대조하는 채점자다.
예측 안건마다, 정답 목록 가운데 같은 안건을 가리키는 것의 key 를 고른다.
- 같은 결정 대상(무엇을 정해야 하는가)을 다루면 같은 안건이다. 표현이 달라도 된다.
- 예측이 "안건 아님" 목록의 대상을 안건으로 올렸으면 그 안건 아님 key 를 고른다.
- 어느 쪽에도 없으면 none.
- 한 예측에는 key 하나만 고른다. 여러 예측이 같은 key 를 고를 수 있다.`;

function cacheGet(key: string): string | null {
  const r = db().prepare(`SELECT value FROM llm_cache WHERE key = ?`).get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export async function matchPredictions(opts: {
  gold: GoldIssue[];
  nonIssues: GoldNonIssue[];
  preds: Pred[];
  utts: MeetingUtterance[];
  model?: string;
}): Promise<{ matches: Map<string, { key: string; fit: "clear" | "partial" }>; usage: Usage | null }> {
  const model = opts.model ?? "anthropic/claude-sonnet-5";
  const out = new Map<string, { key: string; fit: "clear" | "partial" }>();
  if (opts.preds.length === 0) return { matches: out, usage: null };

  const text = new Map(opts.utts.map((u) => [u.uid, `${u.speakerName ?? "?"}: ${u.text}`]));
  const quote = (ids: string[]) => ids.slice(0, 8).map((i) => `    [${i}] ${text.get(i) ?? "(없는 발언)"}`).join("\n");
  const msg = [
    "## 정답 안건",
    ...opts.gold.map((g) => `- key=${g.key} (${g.type}) ${g.subject}\n${quote(g.evidence)}`),
    "",
    "## 안건 아님 (회의 안에서 정리된 것)",
    ...(opts.nonIssues.length ? opts.nonIssues.map((n) => `- key=${n.key} ${n.subject}\n${quote(n.evidence)}`) : ["(없음)"]),
    "",
    "## 예측",
    ...opts.preds.map(
      (p) => `- pid=${p.pid} ${p.type ? `(${p.type}) ` : ""}${p.title}\n${p.positions.map((x) => `    · ${x.who}: ${x.meaning}`).join("\n")}\n${quote(p.evidence)}`,
    ),
  ].join("\n");

  const key = `match:${model}:${createHash("sha256").update(SYS + msg).digest("hex").slice(0, 32)}`;
  let data: z.infer<typeof MatchOut> | null = null;
  let usage: Usage | null = null;
  const cached = cacheGet(key);
  if (cached) data = MatchOut.parse(JSON.parse(cached));
  else {
    const r = await chatJson({
      model,
      schemaName: "eval_match",
      schema: z.toJSONSchema(MatchOut, { target: "draft-07" }) as Record<string, unknown>,
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: msg },
      ],
      maxTokens: 4000,
    });
    usage = r.usage;
    data = MatchOut.parse(r.data);
    db().prepare(`INSERT OR REPLACE INTO llm_cache (key, kind, model, value, created_at) VALUES (?,?,?,?,?)`).run(key, "eval_match", model, JSON.stringify(data), now());
  }
  const valid = new Set([...opts.gold.map((g) => g.key), ...opts.nonIssues.map((n) => n.key)]);
  for (const m of data.matches) out.set(m.pid, { key: valid.has(m.key) ? m.key : "none", fit: m.fit });
  return { matches: out, usage };
}

export type Metrics = {
  preds: number;
  gold: number;
  tp: number;
  fp: number;
  duplicates: number;
  falseEscalations: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  evidencePrecision: number | null;
  evidenceRecall: number | null;
  typeAccuracy: number | null;
  matchedKeys: string[];
  missedKeys: string[];
  escalatedKeys: string[];
};

/**
 * 채점. 한 정답에 예측이 여럿 붙으면 첫 번째만 맞힌 것으로 치고 나머지는 중복(오답)으로 센다.
 * 안건 아님을 안건으로 올린 것은 과잉 경보다(오답에도 포함).
 */
export function score(preds: Pred[], matches: Map<string, { key: string; fit: string }>, gold: GoldIssue[], nonIssues: GoldNonIssue[]): Metrics {
  const goldByKey = new Map(gold.map((g) => [g.key, g]));
  const nonKeys = new Set(nonIssues.map((n) => n.key));
  const seen = new Set<string>();
  let tp = 0,
    dup = 0,
    fe = 0,
    typeOk = 0,
    evInter = 0,
    evPred = 0,
    evGold = 0;
  const escalated: string[] = [];
  for (const p of preds) {
    const k = matches.get(p.pid)?.key ?? "none";
    if (goldByKey.has(k)) {
      if (seen.has(k)) {
        dup++;
        continue;
      }
      seen.add(k);
      tp++;
      const g = goldByKey.get(k)!;
      if (p.type && p.type === g.type) typeOk++;
      const ge = new Set(g.evidence);
      const pe = new Set(p.evidence);
      evInter += [...pe].filter((e) => ge.has(e)).length;
      evPred += pe.size;
      evGold += ge.size;
    } else if (nonKeys.has(k)) {
      fe++;
      escalated.push(k);
    }
  }
  const fp = preds.length - tp;
  const precision = preds.length ? tp / preds.length : null;
  const recall = gold.length ? tp / gold.length : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === null && recall === null ? null : 0;
  return {
    preds: preds.length,
    gold: gold.length,
    tp,
    fp,
    duplicates: dup,
    falseEscalations: fe,
    precision,
    recall,
    f1,
    evidencePrecision: evPred ? evInter / evPred : null,
    evidenceRecall: evGold ? evInter / evGold : null,
    typeAccuracy: tp ? typeOk / tp : null,
    matchedKeys: [...seen],
    missedKeys: gold.map((g) => g.key).filter((k) => !seen.has(k)),
    escalatedKeys: escalated,
  };
}
