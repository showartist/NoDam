/**
 * 창 단위 분석 (중간보고서 기술 2·6번: 슬라이딩 윈도우 + 증분 업데이트).
 *
 * 회의 전체를 매번 다시 읽지 않는다(107발언 전체 분석에 81~215초). 새 발언 창과
 * "지금까지의 안건 요약"만 넣고, 새 안건·기존 안건 갱신만 돌려받아 key 로 합친다.
 *
 *   state        — 지금까지의 안건(key → issue)과 번호(key → A-NN), 창 기록
 *   runWindow()  — 새 창 하나를 분석해 state 를 갱신하고, 바뀐 안건 목록을 돌려준다
 *   planWindows() — 발언 배열을 창으로 나눈다(평가·재생 모드용)
 *
 * 규칙 검사(assemble)는 창마다 그대로 적용한다. 근거 발언은 앞 맥락과 이번 창에 보이는 번호만 인정한다.
 */
import { chatJson, LlmError, type Usage } from "../llm/openrouter";
import { assembleAll, type AssembleStats } from "./assemble";
import { runContextChecks, type ContextCheckOptions } from "./context";
import { buildSpeakerLabels, formatTranscript, labelOf, participantLine, SYSTEM_PROMPT_V2, WINDOW_ADDENDUM, type SpeakerLabel } from "./prompt";
import { LlmAnalysisOutput, llmOutputJsonSchema, SLOT_LABEL, type AgreementV2, type AlignmentIssueV2 } from "./schema";
import type { MeetingUtterance } from "./store";

export const DEFAULT_WINDOW_MODEL = process.env.SCENENOTE_WINDOW_MODEL ?? "anthropic/claude-haiku-4.5";

export type WindowState = {
  meetingId: string;
  runId: string;
  issues: Map<string, AlignmentIssueV2>;
  ids: Map<string, string>;
  agreements: AgreementV2[];
  windows: { from: string; to: string; newKeys: string[]; updatedKeys: string[]; latencyMs: number; costUsd: number | null }[];
  stats: AssembleStats[];
  usages: Usage[];
};

export function newWindowState(meetingId: string, runId: string): WindowState {
  return { meetingId, runId, issues: new Map(), ids: new Map(), agreements: [], windows: [], stats: [], usages: [] };
}

/** 지금까지의 안건을 LLM 이 읽을 짧은 요약으로. 입장은 화자 라벨과 항목 값만. */
export function summarizeIssues(issues: AlignmentIssueV2[], labels: Map<string, SpeakerLabel>): string {
  if (issues.length === 0) return "(아직 없음)";
  return issues
    .map((i) => {
      const pos = i.positions
        .map((p) => {
          const slots = Object.entries(p.slots)
            .map(([k, v]) => `${SLOT_LABEL[k as keyof typeof SLOT_LABEL]}=${v}`)
            .join(", ");
          return `  - ${labelOf(labels, p.speaker.key)}: ${p.meaning}${slots ? ` [${slots}]` : ""} (근거 ${p.evidence.join(",")})`;
        })
        .join("\n");
      return `- key=${i.key} (${i.type}, ${i.state}) ${i.decision}\n${pos}`;
    })
    .join("\n");
}

export function planWindows(utts: MeetingUtterance[], size = 15, contextSize = 6): { context: MeetingUtterance[]; window: MeetingUtterance[] }[] {
  const out: { context: MeetingUtterance[]; window: MeetingUtterance[] }[] = [];
  for (let i = 0; i < utts.length; i += size) {
    out.push({ context: utts.slice(Math.max(0, i - contextSize), i), window: utts.slice(i, i + size) });
  }
  return out;
}

export type WindowResult = {
  newIssues: AlignmentIssueV2[];
  updatedIssues: AlignmentIssueV2[];
  latencyMs: number;
  stats: AssembleStats;
};

/**
 * 창 하나 분석. allUtts 는 지금까지 들어온 전체 발언(화자 라벨을 회의 내내 같게 유지하려고 쓴다).
 */
export async function runWindow(
  state: WindowState,
  opts: {
    allUtts: MeetingUtterance[];
    context: MeetingUtterance[];
    window: MeetingUtterance[];
    meeting: { projectTitle: string | null; sceneLine: string | null };
    model?: string;
    contextCheck?: ContextCheckOptions | false;
    signal?: AbortSignal;
  },
): Promise<WindowResult> {
  const model = opts.model ?? DEFAULT_WINDOW_MODEL;
  const labels = buildSpeakerLabels(opts.allUtts);
  const t0 = Date.now();
  const current = [...state.issues.values()];
  const user = [
    `작품: ${opts.meeting.projectTitle ?? "미상"}`,
    opts.meeting.sceneLine ? `장면: ${opts.meeting.sceneLine}` : null,
    `참석자: ${participantLine(labels)}`,
    "",
    "## 지금까지 찾은 안건",
    summarizeIssues(current, labels),
    "",
    "## 앞 맥락 (이미 분석한 발언)",
    opts.context.length ? formatTranscript(opts.context, labels) : "(없음)",
    "",
    "## 새 발언 창",
    formatTranscript(opts.window, labels),
  ]
    .filter((x) => x !== null)
    .join("\n");

  let data: unknown;
  try {
    const r = await chatJson({
      model,
      schemaName: "scenenote_alignment_window",
      schema: llmOutputJsonSchema(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT_V2 + WINDOW_ADDENDUM },
        { role: "user", content: user },
      ],
      maxTokens: 12000,
      signal: opts.signal,
    });
    data = r.data;
    state.usages.push(r.usage);
  } catch (e) {
    throw e instanceof LlmError ? e : new LlmError("PROVIDER_ERROR", (e as Error).message);
  }
  const parsed = LlmAnalysisOutput.parse(data);

  // 근거로 인정하는 발언: 앞 맥락 + 이번 창 + 이미 안건에 쓰인 발언(갱신 때 기존 근거를 다시 댈 수 있게)
  const visible = new Set([...opts.context, ...opts.window].map((u) => u.uid));
  for (const i of current) for (const e of i.evidence_all) visible.add(e);
  const byUid = new Map(opts.allUtts.map((u) => [u.uid, u]));
  const evidenceUtts = [...visible].map((u) => byUid.get(u)).filter((u): u is MeetingUtterance => !!u);

  const idForKey = (key: string) => {
    const hit = state.ids.get(key);
    if (hit) return hit;
    const id = `A-${String(state.ids.size + 1).padStart(2, "0")}`;
    state.ids.set(key, id);
    return id;
  };

  const assembled = assembleAll(parsed, {
    meetingId: state.meetingId,
    runId: state.runId,
    dataMode: "live",
    utts: evidenceUtts,
    labels,
    window: { from: opts.window[0].uid, to: opts.window[opts.window.length - 1].uid },
    idForKey,
  });

  let changed = assembled.issues;
  if (opts.contextCheck !== false && changed.length) {
    const cc = await runContextChecks(changed, opts.allUtts, opts.contextCheck ?? {});
    changed = cc.issues;
    state.usages.push(...cc.usages);
  }

  const newIssues: AlignmentIssueV2[] = [];
  const updatedIssues: AlignmentIssueV2[] = [];
  for (const i of changed) {
    const prev = state.issues.get(i.key);
    if (prev) {
      // 사람이 이미 승인·제외한 안건은 창 분석이 덮지 않는다.
      if (prev.state === "resolved" || prev.state === "dismissed") continue;
      const merged: AlignmentIssueV2 = { ...i, issue_id: prev.issue_id, created_at: prev.created_at, audit: [...prev.audit, ...i.audit, `창 ${i.window?.from}~${i.window?.to} 에서 갱신`] };
      state.issues.set(i.key, merged);
      updatedIssues.push(merged);
    } else {
      state.issues.set(i.key, i);
      newIssues.push(i);
    }
  }
  for (const a of assembled.agreements) if (!state.agreements.some((x) => x.topic === a.topic)) state.agreements.push(a);

  const latencyMs = Date.now() - t0;
  state.stats.push(assembled.stats);
  state.windows.push({
    from: opts.window[0].uid,
    to: opts.window[opts.window.length - 1].uid,
    newKeys: newIssues.map((i) => i.key),
    updatedKeys: updatedIssues.map((i) => i.key),
    latencyMs,
    costUsd: state.usages.at(-1)?.costUsd ?? null,
  });
  return { newIssues, updatedIssues, latencyMs, stats: assembled.stats };
}

/** 저장된 발언을 처음부터 창 단위로 흘려 보낸다(평가·재생 확인용). */
export async function runAllWindows(
  meetingId: string,
  runId: string,
  utts: MeetingUtterance[],
  meeting: { projectTitle: string | null; sceneLine: string | null },
  opts: { size?: number; model?: string; contextCheck?: ContextCheckOptions | false; onWindow?: (r: WindowResult, s: WindowState) => void } = {},
): Promise<WindowState> {
  const state = newWindowState(meetingId, runId);
  const plan = planWindows(utts, opts.size ?? 15);
  for (let k = 0; k < plan.length; k++) {
    const seen = utts.slice(0, utts.indexOf(plan[k].window[plan[k].window.length - 1]) + 1);
    const r = await runWindow(state, { allUtts: seen, context: plan[k].context, window: plan[k].window, meeting, model: opts.model, contextCheck: opts.contextCheck });
    opts.onWindow?.(r, state);
  }
  return state;
}
