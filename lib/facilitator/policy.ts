import { z } from "zod";

export const FacilitatorConfig = z.object({
  goal: z.string().trim().min(10).max(1500),
  intervalMinutes: z.union([z.literal(3), z.literal(5), z.literal(10)]),
});
export type Config = z.infer<typeof FacilitatorConfig>;
export type Turn = { uid: string; text: string; speakerKey: string | null; startMs: number | null; endMs: number | null };
const Evidence = z.object({ uid: z.string(), quote: z.string().min(1).max(500), context: z.enum(["current", "example"]), role: z.enum(["signal", "baseline"]) });
export const Review = z.object({
  focus: z.enum(["on_topic", "related_examples", "detour", "uncertain"]),
  latestRelation: z.enum(["on_topic", "off_topic", "uncertain"]),
  summary: z.string().max(700),
  findings: z.array(z.object({
    kind: z.enum(["topic_drift", "meaning_gap", "inconsistency"]),
    summary: z.string().max(500),
    question: z.string().min(1).max(300),
    evidence: z.array(Evidence).min(2).max(5),
  })).max(4),
});
export type ModelReview = z.infer<typeof Review>;
export type Notification = { kind: ModelReview["findings"][number]["kind"]; question: string; evidence: z.infer<typeof Evidence>[] };
export type WindowInput = { goal: string; fromMs: number; toMs: number; partial: boolean; prior: Turn[]; current: Turn[] };
export type Assessed = { review: ModelReview; notification: Notification | null; held: string[]; policyVersion: "facilitator-v1"; verification?: { verdict: "supported"|"not_supported"|"uncertain"; reason: string } };

/** Explicit operating policy, not a calibrated probability or a measurement of people. */
export const MIN_DETOUR_SPAN_MS = 90_000;
export function selectWindow(turns: Turn[], fromMs: number, toMs: number) {
  const ready = turns.filter(t => t.endMs != null && t.endMs <= toMs);
  const prior = ready.filter(t => t.endMs! <= fromMs);
  // Keep source text only, never pass earlier model summaries back as facts.
  const context = [...prior.slice(0, 8), ...prior.slice(-40)];
  return { prior: [...new Map(context.map(t => [t.uid, t])).values()], current: ready.filter(t => t.endMs! > fromMs) };
}

function distinctSpeakersKnown(keys:(string|null)[]) {
  if(keys.some(k=>!k)||new Set(keys).size<2)return false;
  const local=keys.map(k=>k!.match(/^C(\d+)-/));
  return local.every(x=>!x)||local.every(x=>x&&x[1]===local[0]?.[1]);
}
export function assessReview(value: unknown, input: WindowInput, previous: { atMs: number; kind: Notification["kind"] }[], intervalMs: number): Assessed {
  const review = Review.parse(value);
  const available = new Map([...input.prior, ...input.current].map(t => [t.uid, t]));
  const currentIds = new Set(input.current.map(t => t.uid));
  const held: string[] = [];
  const eligible: typeof review.findings = [];
  for (const f of review.findings) {
    const refs = f.evidence.map(ev => {
      const u = available.get(ev.uid);
      if (!u || !u.text.includes(ev.quote)) throw new Error(`원문 인용 불일치: ${ev.uid}`);
      return u;
    });
    let why: string | null = null;
    if (new Set(refs.map(t => t.uid)).size < 2) why = "서로 다른 발언 근거 부족";
    else if (!refs.some(t => currentIds.has(t.uid))) why = "이번 구간의 새로운 근거 없음";
    else if (f.evidence.some(ev => ev.context === "example")) why = "과거 사례·인용은 현재 충돌 근거로 사용하지 않음";
    else if (f.kind === "inconsistency" && (!refs[0].speakerKey || refs.some(t => t.speakerKey !== refs[0].speakerKey))) why = "같은 화자의 앞뒤 발언이 아님 또는 화자 미상";
    else if (f.kind === "meaning_gap" && !distinctSpeakersKnown(refs.map(t => t.speakerKey))) why = "서로 다른 화자 근거 부족";
    else if (f.kind === "topic_drift") {
      const current = refs.filter((t,i) => currentIds.has(t.uid) && f.evidence[i].role === "signal");
      const starts = current.map(t => t.startMs).filter((t): t is number => t != null);
      const ends = current.map(t => t.endMs).filter((t): t is number => t != null);
      const latestIds = new Set(input.current.slice(-3).map(t => t.uid));
      if (review.latestRelation !== "off_topic") why = "현재 본론 복귀 또는 흐름 불확실";
      else if (current.length < 2 || starts.length !== current.length || ends.length !== current.length || Math.max(...ends) - Math.min(...starts) < MIN_DETOUR_SPAN_MS) why = "지속적 이탈 근거가 90초에 못 미침";
      else if (!current.some(t => latestIds.has(t.uid))) why = "최근 발언의 이탈 근거 부족";
    }
    if (why) held.push(`${f.kind}: ${why}`); else eligible.push(f);
  }
  let notification: Notification | null = null;
  for (const f of eligible) {
    if (input.partial) { held.push(`${f.kind}: 종료 검토는 자동 알림을 보내지 않음`); continue; }
    if (previous.some(n => n.kind === f.kind && input.toMs - n.atMs < intervalMs * 2)) { held.push(`${f.kind}: 같은 종류 알림의 재안내 대기 시간`); continue; }
    notification = { kind: f.kind, question: f.kind === "topic_drift" ? `이 주제를 이어갈까요, 아니면 “${input.goal.slice(0,200)}”로 돌아갈까요?` : f.question, evidence: f.evidence };
    break;
  }
  return { review, notification, held, policyVersion: "facilitator-v1" };
}
