/**
 * 문맥 검사 (판정 모델).
 *
 * 규칙 검사를 통과한 입장마다 "근거 발언에서 이 뜻이 나오는가"를 판정 모델에 묻는다.
 * 같은 호출에서, 서로 다른 사람이 같은 항목에 말한 값이 같은 것을 가리키는지도 묻는다
 * (해석 거리의 same/differs 판정에 쓴다).
 *
 *   supported    — 그대로 둔다
 *   partial      — 남기고 "추가 확인 필요"를 붙인다
 *   contradicted — 떨어뜨리고 dropped 에 사유를 남긴다
 *
 * 판정 결과는 llm_cache 에 입력 해시로 저장한다.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, now } from "../db";
import { chatJson, type Usage } from "../llm/openrouter";
import { computeDistance, computeSlotDiff, diffLabel, pairKey, type PairVerdict } from "./distance";
import { MIN_DISTINCT_SPEAKERS, SLOT_LABEL, type AlignmentIssueV2, type SlotKey } from "./schema";
import type { MeetingUtterance } from "./store";

export type ContextCheckOptions = { model?: string; concurrency?: number; neighbors?: number; useCache?: boolean };

const JudgeOutput = z.object({
  resolution: z.object({verdict:z.enum(["open","settled","unclear"]),evidence:z.array(z.string()),note:z.string()}),
  positions: z.array(
    z.object({
      index: z.number().int(),
      verdict: z.enum(["supported", "partial", "contradicted"]),
      note: z.string().describe("판정 이유 한 문장"),
    }),
  ),
  slot_pairs: z.array(
    z.object({
      index: z.number().int(),
      verdict: z.enum(["same", "different", "unclear"]),
    }),
  ),
});
type JudgeOutput = z.infer<typeof JudgeOutput>;

const JUDGE_SYSTEM = `당신은 회의 분석 결과를 원문 발언과 대조하는 검사기다. 새 내용을 만들지 말고 판정만 한다.

입장 판정
- supported: 근거 발언이 이 요약을 직접 뒷받침한다.
- partial: 방향은 맞지만 요약이 발언보다 더 나갔거나(과장·추측), 일부만 뒷받침된다.
- contradicted: 발언과 어긋나거나, 다른 사람이 한 말을 이 사람의 말로 썼다.
앞뒤 맥락은 "그거", "네 그렇게" 같은 말이 무엇을 가리키는지 확인한다. S? 또는 화자 미상은 동일인이라는 뜻이 아니며 화자를 추측하지 않는다.

회의 종료 시점의 안건 상태(resolution)
- settled: 이 안건을 뒤에서 명시적으로 수용·선택했고 새 반대나 미해결 조건이 없다. 선택이 이미 끝났는데 질문이 다시 선택을 요구한다면 settled다.
- open: 실제로 남은 선택이나 미충족 조건이 있다. 리허설에서 확인하기로 했지만 실제 확인이 남았으면 open이다.
- unclear: 근거가 충분하지 않다. "일단" 하나만으로 미결이라고 하거나 "네" 하나만으로 해결됐다고 하지 않는다.
- evidence에는 판정의 근거 발언 번호를 넣는다. 뒤의 수용과 재반대까지 확인한다. 이것은 대화에서 정리됐는지 검사하는 것이며 참가자의 최종 승인을 대신하지 않는다.

항목 짝 판정
- same: 영화 제작 현장 기준으로 같은 것을 가리키거나, 한쪽이 다른 쪽을 구체화했을 뿐 서로 부딪히지 않는다.
- different: 실제로 다른 결과물(다른 그림, 다른 조명, 다른 연기)이 나온다.
- unclear: 용어가 여러 뜻으로 읽혀서 확인이 필요하다. 예: "낮은 색온도"는 광원 기준이면 따뜻한 빛, 카메라 화이트밸런스 기준이면 푸른 화면.`;

function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function cacheGet(key: string): string | null {
  const r = db().prepare(`SELECT value FROM llm_cache WHERE key = ?`).get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

function cachePut(key: string, kind: string, model: string, value: string): void {
  db()
    .prepare(`INSERT OR REPLACE INTO llm_cache (key, kind, model, value, created_at) VALUES (?,?,?,?,?)`)
    .run(key, kind, model, value, now());
}

type Pair = { slot: SlotKey; label: string; a: string; b: string; aKey: string; bKey: string };

function differingPairs(issue: AlignmentIssueV2): Pair[] {
  const pairs: Pair[] = [];
  const diff = computeSlotDiff(issue.positions); // exact 기준으로 다른 짝만 판정에 보낸다
  for (const d of diff) {
    const keys = Object.keys(d.values);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = d.values[keys[i]];
        const b = d.values[keys[j]];
        if (a !== b) pairs.push({ slot: d.slot, label: diffLabel(d), a, b, aKey: keys[i], bKey: keys[j] });
      }
    }
  }
  return pairs;
}

function buildJudgeMessage(issue: AlignmentIssueV2, pairs: Pair[], utts: MeetingUtterance[], neighbors: number): string {
  const byUid = new Map(utts.map((u, i) => [u.uid, i]));
  const who = (k: string | null) => {
    const p = issue.positions.find((x) => x.speaker.key === k);
    return p ? [p.speaker.name, p.speaker.role].filter(Boolean).join("·") || k : k;
  };
  const line = (u: MeetingUtterance) => `[${u.uid}] ${who(u.speakerKey) ?? "화자 미상"}: ${u.text}`;
  const blocks = issue.positions.map((p, i) => {
    const idxs = new Set<number>();
    for (const e of p.evidence) {
      const k = byUid.get(e);
      if (k === undefined) continue;
      for (let d = -neighbors; d <= neighbors; d++) if (utts[k + d]) idxs.add(k + d);
    }
    const ctx = [...idxs].sort((a, b) => a - b).map((k) => (p.evidence.includes(utts[k].uid) ? "▶ " : "  ") + line(utts[k]));
    return [
      `입장 ${i}: ${who(p.speaker.key)}`,
      `요약: ${p.meaning}`,
      `인용: "${p.quote}"`,
      `근거 발언(▶)과 앞뒤 맥락:`,
      ...ctx,
    ].join("\n");
  });
  const pairLines = pairs.map(
    (q, i) => `짝 ${i}: 항목 ${q.label} — ${who(q.aKey)} "${q.a}" / ${who(q.bKey)} "${q.b}"`,
  );
  return [
    `안건: ${issue.decision}${issue.concept ? ` (표현: ${issue.concept})` : ""}`,
    "",
    ...blocks,
    "",
    pairs.length ? "항목 짝:" : "항목 짝: 없음 (slot_pairs 는 빈 배열)",
    ...pairLines,
    "회의 전체 시간순 발언 — 뒤에서 수용했거나 다시 번복했는지 확인:",
    ...utts.map(line),
  ].join("\n");
}

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, xs.length) }, async () => {
    while (next < xs.length) {
      const i = next++;
      out[i] = await fn(xs[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type ContextStats = {
  checkedPositions: number;
  supported: number;
  partial: number;
  contradicted: number;
  droppedIssues: { issue_id: string; reason: string }[];
  judgedPairs: number;
  samePairs: number;
  unclearPairs: number;
  cacheHits: number;
  failures: number;
  settledIssues: {issue_id:string;evidence:string[];note:string;issue:AlignmentIssueV2}[];
};

export async function runContextChecks(
  issues: AlignmentIssueV2[],
  utts: MeetingUtterance[],
  opts: ContextCheckOptions = {},
): Promise<{ issues: AlignmentIssueV2[]; usages: Usage[]; stats: ContextStats }> {
  const model = opts.model ?? process.env.SCENENOTE_JUDGE_MODEL ?? "anthropic/claude-haiku-4.5";
  const neighbors = opts.neighbors ?? 2;
  const useCache = opts.useCache ?? true;
  const usages: Usage[] = [];
  const stats: ContextStats = {
    checkedPositions: 0,
    supported: 0,
    partial: 0,
    contradicted: 0,
    droppedIssues: [],
    judgedPairs: 0,
    samePairs: 0,
    unclearPairs: 0,
    cacheHits: 0,
    failures: 0,
    settledIssues: [],
  };
  const schema = z.toJSONSchema(JudgeOutput, { target: "draft-07" }) as Record<string, unknown>;

  const results = await mapLimit(issues, opts.concurrency ?? 4, async (issue) => {
    const pairs = differingPairs(issue);
    const message = buildJudgeMessage(issue, pairs, utts, neighbors);
    const key = `judge:${model}:${hash(JUDGE_SYSTEM + "\n" + message)}`;
    let out: JudgeOutput | null = null;
    const cached = useCache ? cacheGet(key) : null;
    if (cached) {
      stats.cacheHits++;
      out = JudgeOutput.parse(JSON.parse(cached));
    } else {
      try {
        const r = await chatJson({
          model,
          schemaName: "scenenote_context_check",
          schema,
          messages: [
            { role: "system", content: JUDGE_SYSTEM },
            { role: "user", content: message },
          ],
          maxTokens: 3000,
        });
        usages.push(r.usage);
        const p = JudgeOutput.safeParse(r.data);
        if (p.success) {
          out = p.data;
          cachePut(key, "context_check", model, JSON.stringify(out));
        }
      } catch {
        out = null;
      }
    }
    if (!out) {
      stats.failures++;
      return issue; // 판정 실패면 not_checked 로 둔다. 통과로 바꾸지 않는다.
    }

    const resolutionEvidence = [...new Set(out.resolution.evidence)];
    const validIds = new Map(utts.map(u=>[u.uid,u.idx]));
    const firstEvidence = Math.min(...issue.evidence_all.map(uid=>validIds.get(uid)??Infinity));
    if(out.resolution.verdict === "settled" && resolutionEvidence.length > 0 && resolutionEvidence.every(uid=>validIds.has(uid)) && resolutionEvidence.some(uid=>validIds.get(uid)! >= firstEvidence)) {
      stats.settledIssues.push({issue_id:issue.issue_id,evidence:resolutionEvidence,note:out.resolution.note,issue});
      return null;
    }
    const verdicts = new Map<string, PairVerdict>();
    for (const sp of out.slot_pairs) {
      const q = pairs[sp.index];
      if (!q) continue;
      verdicts.set(pairKey(q.slot, q.a, q.b), sp.verdict);
      stats.judgedPairs++;
      if (sp.verdict === "same") stats.samePairs++;
      if (sp.verdict === "unclear") stats.unclearPairs++;
    }

    const byIndex = new Map(out.positions.map((p) => [p.index, p]));
    const dropped = [...issue.dropped];
    const audit = [...issue.audit];
    const positions = issue.positions
      .map((p, i) => {
        const v = byIndex.get(i);
        if (!v) return p;
        stats.checkedPositions++;
        stats[v.verdict]++;
        if (v.verdict === "contradicted") {
          dropped.push({ speaker: p.speaker.name ?? p.speaker.key ?? "?", reason: `문맥 검사: ${v.note}`, evidence: p.evidence });
          return null;
        }
        return { ...p, checks: { ...p.checks, context: v.verdict, contextNote: v.note } };
      })
      .filter((p): p is AlignmentIssueV2["positions"][number] => p !== null);

    const distinct = new Set(positions.map((p) => p.speaker.key).filter(Boolean)).size;
    if ((MIN_DISTINCT_SPEAKERS[issue.type] > 1 && distinct < MIN_DISTINCT_SPEAKERS[issue.type]) || !positions.length) {
      stats.droppedIssues.push({ issue_id: issue.issue_id, reason: `문맥 검사 뒤 서로 다른 화자가 ${distinct}명` });
      return null;
    }
    const slotDiff = computeSlotDiff(positions, verdicts);
    if (verdicts.size) audit.push(`항목 짝 ${verdicts.size}개를 판정 모델로 비교`);
    return { ...issue, positions, dropped, audit, slot_diff: slotDiff, distance: computeDistance(slotDiff) };
  });

  return { issues: results.filter((x): x is AlignmentIssueV2 => x !== null), usages, stats };
}
