/**
 * LLM 출력 → 검사를 거친 해석 차이 오브젝트 v2.
 *
 * 순서
 *   1. 화자 라벨을 화자 키로 되돌린다. 이름·역할은 화자 매핑에서 채운다(LLM 이 쓴 이름은 쓰지 않는다).
 *   2. 입장마다 존재하지 않는 발언 번호를 버리고, 화자 근거 검사·인용 검사를 한다. 떨어진 입장은 dropped 에 남긴다.
 *   3. 같은 화자의 입장이 둘 이상이면 하나로 합친다(한 사람의 정정은 두 사람의 차이가 아니다).
 *   4. 유형별 최소 화자 수를 못 채운 안건은 떨어뜨린다.
 *   5. 합의 후보인데 근거에 조건·보류 표현이 있으면 조건부 합의로 내린다.
 *   6. 항목 비교(slot_diff)와 해석 거리를 계산한다.
 */
import {
  MIN_DISTINCT_SPEAKERS,
  SCHEMA_VERSION,
  SEVERITIES,
  type AgreementV2,
  type AlignmentIssueV2,
  type LlmAnalysisOutput,
  type LlmIssue,
  type PositionV2,
  type SlotKey,
} from "./schema";
import { checkSpeakerEvidence, conditionPhrase, quoteFound } from "./checks";
import { computeDistance, computeSlotDiff, type PairVerdict } from "./distance";
import type { SpeakerLabel } from "./prompt";
import type { MeetingUtterance } from "./store";

export type AssembleContext = {
  meetingId: string;
  runId: string;
  dataMode: "live" | "fixture";
  utts: MeetingUtterance[];
  labels: Map<string, SpeakerLabel>;
  window: { from: string; to: string } | null;
  /** 창 단위 분석에서 같은 key 의 안건 번호를 유지하려고 쓴다. 없으면 정렬 뒤 A-01 부터 붙인다 */
  idForKey?: (key: string) => string;
  verdicts?: Map<string, PairVerdict>;
  now?: string;
};

export type AssembleStats = {
  llmIssues: number;
  keptIssues: number;
  droppedIssues: { key: string; type: string; reason: string }[];
  droppedPositions: number;
  quoteNotFound: number;
  speakerMismatch: number;
  invalidUids: number;
  mergedPositions: number;
  stateAdjusted: number;
};

export function emptyStats(): AssembleStats {
  return {
    llmIssues: 0,
    keptIssues: 0,
    droppedIssues: [],
    droppedPositions: 0,
    quoteNotFound: 0,
    speakerMismatch: 0,
    invalidUids: 0,
    mergedPositions: 0,
    stateAdjusted: 0,
  };
}

function labelToKey(labels: Map<string, SpeakerLabel>): Map<string, SpeakerLabel> {
  const m = new Map<string, SpeakerLabel>();
  for (const l of labels.values()) m.set(l.label, l);
  return m;
}

export function assembleIssue(
  li: LlmIssue,
  ctx: AssembleContext,
  stats: AssembleStats,
): Omit<AlignmentIssueV2, "issue_id"> | null {
  const byUid = new Map(ctx.utts.map((u) => [u.uid, u]));
  const byLabel = labelToKey(ctx.labels);
  const valid = (xs: string[]) => {
    const kept = xs.map((x) => x.trim()).filter((x) => byUid.has(x));
    stats.invalidUids += xs.length - kept.length;
    return [...new Set(kept)];
  };

  const dropped: AlignmentIssueV2["dropped"] = [];
  const audit: string[] = [];
  const kept: PositionV2[] = [];

  for (const p of li.positions) {
    const lab = byLabel.get(p.speaker.trim());
    const key = lab?.key ?? null;
    const evidence = valid(p.evidence);
    if (evidence.length === 0) {
      stats.droppedPositions++;
      dropped.push({ speaker: p.speaker, reason: "회의에 있는 근거 발언이 없음", evidence });
      continue;
    }
    const sc = checkSpeakerEvidence(key, evidence, byUid);
    if (sc.result !== "ok") {
      stats.droppedPositions++;
      if (sc.result === "mismatch") stats.speakerMismatch++;
      dropped.push({
        speaker: p.speaker,
        reason: sc.result === "mismatch" ? "근거 발언 중에 이 화자가 직접 한 발언이 없음" : "화자를 알 수 없음",
        evidence,
      });
      continue;
    }
    const texts = evidence.map((e) => byUid.get(e)!.text);
    const qok = quoteFound(p.quote, texts);
    if (!qok) {
      stats.droppedPositions++;
      stats.quoteNotFound++;
      dropped.push({ speaker: p.speaker, reason: `인용 구절이 근거 발언에 없음: "${p.quote.slice(0, 40)}"`, evidence });
      continue;
    }
    const slots: Partial<Record<SlotKey, string>> = {};
    for (const s of p.slots) if (s.value.trim()) slots[s.slot] = s.value.trim();
    kept.push({
      speaker: { key, name: lab?.name ?? null, role: lab?.role ?? null },
      meaning: p.meaning.trim(),
      quote: p.quote.trim(),
      evidence,
      slots,
      checks: { speaker: "ok", quote: "ok", context: "not_checked", contextNote: null },
    });
  }

  // 같은 화자의 입장 합치기: 근거는 합치고, 항목 값은 나중 입장(더 늦은 발언)의 값을 쓴다.
  const merged = new Map<string, PositionV2>();
  const order = (p: PositionV2) => Math.max(...p.evidence.map((e) => byUid.get(e)?.idx ?? 0));
  for (const p of [...kept].sort((a, b) => order(a) - order(b))) {
    const k = p.speaker.key!;
    const prev = merged.get(k);
    if (!prev) {
      merged.set(k, p);
      continue;
    }
    stats.mergedPositions++;
    audit.push(`${ctx.labels.get(k)?.label ?? k} 의 입장 두 개를 하나로 합침`);
    merged.set(k, {
      ...p,
      meaning: prev.meaning === p.meaning ? p.meaning : `${prev.meaning} → ${p.meaning}`,
      evidence: [...new Set([...prev.evidence, ...p.evidence])],
      slots: { ...prev.slots, ...p.slots },
    });
  }
  const positions = [...merged.values()];

  const distinct = new Set(positions.map((p) => p.speaker.key)).size;
  const need = MIN_DISTINCT_SPEAKERS[li.type];
  if (distinct < need) {
    stats.droppedIssues.push({
      key: li.key,
      type: li.type,
      reason: `검사를 통과한 서로 다른 화자가 ${distinct}명 (이 유형은 ${need}명 이상 필요)`,
    });
    return null;
  }

  let state = li.state as AlignmentIssueV2["state"];
  let condition = li.condition ? { text: li.condition.text.trim(), evidence: valid(li.condition.evidence) } : null;
  const evidenceAll = [...new Set([...positions.flatMap((p) => p.evidence), ...(condition?.evidence ?? [])])].sort(
    (a, b) => (byUid.get(a)?.idx ?? 0) - (byUid.get(b)?.idx ?? 0),
  );
  if (state === "agreed_candidate") {
    for (const e of evidenceAll) {
      const phrase = conditionPhrase(byUid.get(e)?.text ?? "");
      if (phrase) {
        state = "conditional";
        condition = condition ?? { text: `근거 발언 ${e} 에 조건 표현("${phrase}")이 있음`, evidence: [e] };
        stats.stateAdjusted++;
        audit.push(`합의 후보를 조건부 합의로 내림: ${e} "${phrase}"`);
        break;
      }
    }
  }

  const slotDiff = computeSlotDiff(positions, ctx.verdicts);
  const ts = ctx.now ?? new Date().toISOString();
  const roleBriefs: Record<string, string> = {};
  for (const rb of li.role_briefs) if (rb.role.trim() && rb.text.trim()) roleBriefs[rb.role.trim()] = rb.text.trim();

  return {
    schema: SCHEMA_VERSION,
    key: li.key.trim() || `issue_${Math.random().toString(36).slice(2, 7)}`,
    meeting_id: ctx.meetingId,
    analysis_run_id: ctx.runId,
    data_mode: ctx.dataMode,
    window: ctx.window,
    type: li.type,
    decision: li.decision.trim(),
    concept: li.concept.trim(),
    state,
    condition,
    positions,
    slot_diff: slotDiff,
    distance: computeDistance(slotDiff),
    question: li.question.trim(),
    why_it_matters: li.why_it_matters.trim(),
    severity: li.severity,
    role_briefs: roleBriefs,
    evidence_all: evidenceAll,
    dropped,
    audit,
    past_decisions: [],
    created_at: ts,
    updated_at: ts,
  };
}

/** 심각도 → 첫 근거 발언 순서로 정렬해 A-01 부터 번호를 붙인다. */
export function assignIds(issues: Omit<AlignmentIssueV2, "issue_id">[], utts: MeetingUtterance[]): AlignmentIssueV2[] {
  const idx = new Map(utts.map((u) => [u.uid, u.idx]));
  const first = (i: Omit<AlignmentIssueV2, "issue_id">) => Math.min(...i.evidence_all.map((e) => idx.get(e) ?? 1e9));
  const sev = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);
  return [...issues]
    .sort((a, b) => sev(a.severity) - sev(b.severity) || first(a) - first(b))
    .map((i, n) => ({ issue_id: `A-${String(n + 1).padStart(2, "0")}`, ...i }));
}

export function assembleAll(
  out: LlmAnalysisOutput,
  ctx: AssembleContext,
): { issues: AlignmentIssueV2[]; agreements: AgreementV2[]; stats: AssembleStats } {
  const stats = emptyStats();
  stats.llmIssues = out.issues.length;
  const built = out.issues
    .map((li) => assembleIssue(li, ctx, stats))
    .filter((x): x is Omit<AlignmentIssueV2, "issue_id"> => x !== null);

  // 같은 key 가 두 번 나오면 뒤의 것에 접미사를 붙인다(창 병합에서 key 가 식별자라서).
  const seen = new Map<string, number>();
  for (const b of built) {
    const n = seen.get(b.key) ?? 0;
    seen.set(b.key, n + 1);
    if (n > 0) b.key = `${b.key}_${n + 1}`;
  }

  const issues = ctx.idForKey
    ? built.map((b) => ({ issue_id: ctx.idForKey!(b.key), ...b }))
    : assignIds(built, ctx.utts);
  stats.keptIssues = issues.length;

  const textOf = new Map(ctx.utts.map((u) => [u.uid, u.text]));
  const agreements: AgreementV2[] = out.agreements
    .map((a) => {
      const evidence = [...new Set(a.evidence.filter((e) => textOf.has(e)))];
      // LLM 이 조건 붙은 결정을 합의로 넣는 경우가 있다. 근거 발언에 조건 표현이 있으면 표시한다.
      const phrase = evidence.map((e) => conditionPhrase(textOf.get(e) ?? "")).find(Boolean) ?? null;
      return { topic: a.topic.trim(), summary: a.summary.trim(), evidence, condition: phrase };
    })
    .filter((a) => a.topic && a.evidence.length > 0);
  return { issues, agreements, stats };
}
