/**
 * 회의 간 일관성 검사 (계획서 3-3, 중간보고서 기술 9번).
 *
 * 1. 같은 작품의 다른 회의에서 사람이 승인한 결정(원장)을 가져온다.
 * 2. 원장 결정마다 이번 회의 발언 중 가까운 것을 임베딩으로 몇 개 고른다(후보 좁히기).
 * 3. 판정 모델이 발언이 그 결정과 부딪히는지(conflict), 같은지(consistent), 무관한지(unrelated) 가린다.
 * 4. 부딪히면 "과거 결정 충돌" 안건을 만든다. 입장은 이번 회의 발언만, 과거 결정은 past_decisions 에 둔다.
 *
 * 판정은 후보로 고른 발언만 본다. 임베딩 후보에 들지 못한 발언의 충돌은 놓칠 수 있다(평가 수치로 드러낸다).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { db, now } from "../db";
import { chatJson, cosine, type Usage } from "../llm/openrouter";
import { computeDistance, computeSlotDiff } from "../alignment/distance";
import { SCHEMA_VERSION, SLOT_LABEL, type AgreementV2, type AlignmentIssueV2, type SlotKey } from "../alignment/schema";
import type { MeetingUtterance } from "../alignment/store";
import { ensureLedgerEmbeddings, ensureMeetingEmbeddings, ledgerText, listLedger, type LedgerEntry } from "./ledger";
import { josa } from "../text/josa";
import { LEDGER_KEY_PREFIX } from "../alignment/present";

const Verdict = z.object({
  items: z.array(
    z.object({
      uid: z.string(),
      verdict: z.enum(["conflict", "consistent", "unrelated"]),
      current_value: z.string().describe("이 발언이 그 항목에 대해 말한 값. 짧은 명사구. unrelated 면 빈 문자열"),
      note: z.string().describe("판정 이유 한 문장"),
    }),
  ),
});

const SYS = `당신은 영화 제작 회의에서 지난 회의에 승인된 결정과 이번 회의 발언을 대조하는 검사기다.
발언마다 판정한다.
- conflict: 이번 발언이 승인된 값과 다른 값을 전제하거나 제안한다(예: 승인은 "짙은 남색 코트", 발언은 "카멜색 코트 준비").
- consistent: 같은 값을 따르거나 다시 확인한다.
- unrelated: 그 항목과 관계없다.
확실하지 않으면 unrelated 로 둔다. 다른 장면·다른 인물 이야기면 unrelated 다.`;

export type ConsistencyStats = { ledgerEntries: number; candidates: number; conflicts: number; newIssues: number; skipped?: string };

function neighbors(utts: MeetingUtterance[], uid: string, k = 1): MeetingUtterance[] {
  const i = utts.findIndex((u) => u.uid === uid);
  return i < 0 ? [] : utts.slice(Math.max(0, i - k), i + k + 1);
}

export async function checkPastDecisions(opts: {
  meetingId: string;
  projectId: string | null;
  runId: string;
  utts: MeetingUtterance[];
  existingIssueIds: string[];
  model?: string;
  topK?: number;
  minScore?: number;
}): Promise<{ issues: AlignmentIssueV2[]; stats: ConsistencyStats; usages: Usage[] }> {
  const usages: Usage[] = [];
  if (!opts.projectId) return { issues: [], stats: { ledgerEntries: 0, candidates: 0, conflicts: 0, newIssues: 0, skipped: "작품 없음" }, usages };
  const ledger = listLedger(opts.projectId, { excludeMeetingId: opts.meetingId, activeOnly: true });
  if (!ledger.length) return { issues: [], stats: { ledgerEntries: 0, candidates: 0, conflicts: 0, newIssues: 0, skipped: "다른 회의의 승인된 결정 없음" }, usages };

  await ensureLedgerEmbeddings(ledger);
  await ensureMeetingEmbeddings(opts.meetingId);
  const embRows = db().prepare(`SELECT uid, embedding FROM utterance_embeddings WHERE meeting_id = ?`).all(opts.meetingId) as { uid: string; embedding: string }[];
  const emb = new Map(embRows.map((r) => [r.uid, JSON.parse(r.embedding) as number[]]));
  const byUid = new Map(opts.utts.map((u) => [u.uid, u]));
  const model = opts.model ?? process.env.SCENENOTE_CONSISTENCY_MODEL ?? "anthropic/claude-sonnet-5";
  const schema = z.toJSONSchema(Verdict, { target: "draft-07" }) as Record<string, unknown>;

  const found: { entry: LedgerEntry; hits: { u: MeetingUtterance; value: string; note: string }[] }[] = [];
  let candidates = 0;
  for (const entry of ledger) {
    const scored = opts.utts
      .map((u) => ({ u, s: emb.has(u.uid) && entry.embedding ? cosine(entry.embedding, emb.get(u.uid)!) : -1 }))
      .filter((x) => x.s >= (opts.minScore ?? 0.45))
      .sort((a, b) => b.s - a.s)
      .slice(0, opts.topK ?? 4);
    if (!scored.length) continue;
    candidates += scored.length;
    const msg = [
      `승인된 결정(다른 회의 ${entry.meeting_id}, ${entry.decided_by} 승인): ${ledgerText(entry)}`,
      "",
      "이번 회의 발언(▶ 가 판정 대상, 나머지는 앞뒤 맥락):",
      ...scored.flatMap(({ u }) =>
        neighbors(opts.utts, u.uid).map((n) => `${n.uid === u.uid ? "▶" : " "} [${n.uid}] ${n.speakerName ?? n.speakerKey ?? "화자 미상"}: ${n.text}`),
      ),
      "",
      `판정 대상: ${scored.map(({ u }) => u.uid).join(", ")}`,
    ].join("\n");
    const cacheKey = `consistency:${model}:${createHash("sha256").update(SYS + msg).digest("hex").slice(0, 32)}`;
    const cached = db().prepare(`SELECT value FROM llm_cache WHERE key = ?`).get(cacheKey) as { value: string } | undefined;
    let v: z.infer<typeof Verdict>;
    if (cached) v = Verdict.parse(JSON.parse(cached.value));
    else {
      const r = await chatJson({ model, schemaName: "consistency_check", schema, messages: [{ role: "system", content: SYS }, { role: "user", content: msg }], maxTokens: 2000 });
      usages.push(r.usage);
      v = Verdict.parse(r.data);
      db().prepare(`INSERT OR REPLACE INTO llm_cache (key, kind, model, value, created_at) VALUES (?,?,?,?,?)`).run(cacheKey, "consistency", model, JSON.stringify(v), now());
    }
    const allowed = new Set(scored.map(({ u }) => u.uid));
    const hits = v.items
      .filter((it) => it.verdict === "conflict" && allowed.has(it.uid) && byUid.has(it.uid))
      .map((it) => ({ u: byUid.get(it.uid)!, value: it.current_value.trim(), note: it.note.trim() }));
    if (hits.length) found.push({ entry, hits });
  }

  // 원장 결정 하나당 안건 하나. 입장은 이번 회의에서 부딪힌 발언을 화자별로 묶는다.
  let n = opts.existingIssueIds.length;
  const ts = now();
  const issues: AlignmentIssueV2[] = found.map(({ entry, hits }) => {
    const bySpeaker = new Map<string, typeof hits>();
    for (const h of hits) {
      const k = h.u.speakerKey ?? "?";
      bySpeaker.set(k, [...(bySpeaker.get(k) ?? []), h]);
    }
    const slot = entry.slot as SlotKey;
    const positions = [...bySpeaker.entries()].map(([key, hs]) => ({
      speaker: { key: key === "?" ? null : key, name: hs[0].u.speakerName, role: hs[0].u.role },
      meaning: hs.map((h) => h.note).join(" / "),
      quote: hs[0].u.text.slice(0, 40),
      evidence: hs.map((h) => h.u.uid),
      slots: hs[0].value ? ({ [slot]: hs[0].value } as Partial<Record<SlotKey, string>>) : {},
      checks: { speaker: "ok" as const, quote: "ok" as const, context: "supported" as const, contextNote: "원장 대조 판정" },
    }));
    // 항목 비교표에 과거 결정 값을 한 줄로 넣어, 지금 값과 나란히 보이게 한다.
    const withPast = [
      ...positions,
      { speaker: { key: `${LEDGER_KEY_PREFIX}${entry.id}`, name: "지난 회의 결정", role: null }, meaning: "", quote: "", evidence: [], slots: { [slot]: entry.value } as Partial<Record<SlotKey, string>>, checks: positions[0].checks },
    ];
    const diff = computeSlotDiff(withPast);
    const label = SLOT_LABEL[slot] ?? slot;
    const current = hits[0].value || "다른 값";
    return {
      schema: SCHEMA_VERSION,
      issue_id: `A-${String(++n).padStart(2, "0")}`,
      key: `past_${entry.id}`,
      meeting_id: opts.meetingId,
      analysis_run_id: opts.runId,
      data_mode: "live",
      window: null,
      type: "past_decision_conflict",
      decision: entry.decision,
      concept: label,
      state: "open",
      condition: null,
      positions,
      slot_diff: diff,
      distance: computeDistance(diff, "지난 결정과 이번 회의가 함께 다룬"),
      question: `지난 회의에서 ${josa(label, "을/를")} "${entry.value}"${josa(entry.value, "(으)로").slice(entry.value.length)} 승인했습니다. 이번 회의의 "${current}"${josa(current, "(으)로").slice(current.length)} 바꿀지, 승인한 값으로 되돌릴지 정해 주세요.`,
      why_it_matters: `승인된 결정과 다른 값으로 준비가 진행되면 ${label} 관련 발주·촬영이 두 갈래로 나뉩니다.`,
      severity: "high",
      role_briefs: {},
      evidence_all: [...new Set(hits.map((h) => h.u.uid))],
      dropped: [],
      audit: [`원장 ${entry.id}(${entry.decided_by}, ${entry.decided_at.slice(0, 10)})과 대조`],
      past_decisions: [
        {
          ledger_id: entry.id,
          meeting_id: entry.meeting_id,
          slot: entry.slot,
          value: entry.value,
          evidence: entry.evidence,
          meeting_title: meetingTitle(entry.meeting_id),
          decided_by: entry.decided_by,
        },
      ],
      created_at: ts,
      updated_at: ts,
    };
  });
  return { issues, stats: { ledgerEntries: ledger.length, candidates, conflicts: found.reduce((a, f) => a + f.hits.length, 0), newIssues: issues.length }, usages };
}

function meetingTitle(meetingId: string): string | null {
  const r = db().prepare(`SELECT title FROM meetings WHERE id = ?`).get(meetingId) as { title: string | null } | undefined;
  return r?.title ?? null;
}

/**
 * 승인된 결정과 부딪힌 발언을 근거로 한 "확정 후보" 합의를 뺀다.
 * 같은 발언이 합의 후보와 과거 결정 충돌 안건에 동시에 오르지 않게 한다. 뺀 합의는 그 충돌 안건의 검사 기록에 남긴다.
 */
export function withdrawConflictingAgreements(agreements: AgreementV2[], conflicts: AlignmentIssueV2[]): { agreements: AgreementV2[]; withdrawn: number } {
  let kept = agreements;
  for (const issue of conflicts) {
    const uids = new Set(issue.evidence_all);
    const hit = kept.filter((a) => a.evidence.some((u) => uids.has(u)));
    if (!hit.length) continue;
    kept = kept.filter((a) => !hit.includes(a));
    issue.audit.push(...hit.map((a) => `지난 결정과 부딪혀 합의 후보에서 뺌: ${a.topic} (${a.evidence.join(", ")})`));
  }
  return { agreements: kept, withdrawn: agreements.length - kept.length };
}
