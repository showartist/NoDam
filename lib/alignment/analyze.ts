import { getIntakeMetadata, intakeContext } from "../meetingIntake/store";
/**
 * 해석 차이 탐지 v2 — 회의 전체 일괄 분석(batch).
 *
 * 흐름: 발언 읽기 → 화자 라벨 → LLM(json_schema strict) → zod 검증 → 규칙 검사(assemble)
 *       → (선택) 문맥 검사·항목 짝 판정 → 저장
 * 실패도 run 으로 남긴다. "돌렸는데 없었다"와 "실패했다"는 다르다.
 */
import {beginAnalysisJob,renewAnalysisJob,assertAnalysisJob} from "./jobs";
import { db } from "../db";
import { chatJson, LlmError, sumUsage, type Usage } from "../llm/openrouter";
import { assembleAll, assignIds, type AssembleStats } from "./assemble";
import { buildBatchUserMessage, buildSpeakerLabels, SYSTEM_PROMPT_V2, type SpeakerLabel } from "./prompt";
import { LlmAnalysisOutput, llmOutputJsonSchema, type AgreementV2, type AlignmentIssueV2 } from "./schema";
import { finishRun, getMeetingUtterances, saveIssues, type MeetingUtterance } from "./store";
import { runContextChecks, type ContextCheckOptions } from "./context";
import { checkPastDecisions, withdrawConflictingAgreements } from "../consistency/check";

export const DEFAULT_ANALYSIS_MODEL = process.env.SCENENOTE_ANALYSIS_MODEL ?? process.env.OPENROUTER_ANALYSIS_MODEL ?? "anthropic/claude-sonnet-5";

export class AnalysisV2Error extends Error {
  constructor(
    readonly code: "NO_INPUT" | "NOT_CONFIGURED" | "LLM_FAILED" | "INVALID_OUTPUT",
    message: string,
    readonly runId?: string,
  ) {
    super(message);
    this.name = "AnalysisV2Error";
  }
}

export type MeetingContext = { projectTitle: string | null; sceneLine: string | null; projectId: string | null };

export function getMeetingContext(meetingId: string): MeetingContext {
  const row = db()
    .prepare(
      `SELECT m.title AS meeting_title, p.id AS project_id, p.title AS project_title, p.one_line
         FROM meetings m LEFT JOIN projects p ON p.id = m.project_id WHERE m.id = ?`,
    )
    .get(meetingId) as { meeting_title: string | null; project_id: string | null; project_title: string | null; one_line: string | null } | undefined;
  const intake = getIntakeMetadata(meetingId);
  return {
    projectTitle: row?.project_title ?? null,
    sceneLine: intake ? intakeContext(intake) : [row?.meeting_title, row?.one_line].filter(Boolean).join(" · ") || null,
    projectId: row?.project_id ?? null,
  };
}

export type BatchResult = {
  runId: string;
  model: string;
  issues: AlignmentIssueV2[];
  agreements: AgreementV2[];
  stats: AssembleStats & { context?: unknown; consistency?: unknown };
  usage: ReturnType<typeof sumUsage>;
  latencyMs: number;
};

/**
 * 발언 배열을 직접 받아 분석한다(평가 스크립트가 DB 없이 쓰려고 분리).
 * 저장은 하지 않는다.
 */
export async function analyzeUtterances(opts: {
  meetingId: string;
  runId: string;
  utts: MeetingUtterance[];
  context: MeetingContext;
  model?: string;
  dataMode?: "live" | "fixture";
  contextCheck?: ContextCheckOptions | false;
  signal?: AbortSignal;
  /** 평가용: 단계별 중간 결과(LLM 원출력, 규칙 검사 뒤)를 받는다. */
  onStage?: (s: { stage: "llm"; raw: LlmAnalysisOutput; labels: Map<string, SpeakerLabel> } | { stage: "rules"; issues: AlignmentIssueV2[] }) => void;
}): Promise<Omit<BatchResult, "runId">> {
  const model = opts.model ?? DEFAULT_ANALYSIS_MODEL;
  if (opts.utts.length === 0) throw new AnalysisV2Error("NO_INPUT", "분석할 발언이 없습니다.");
  const labels = buildSpeakerLabels(opts.utts);
  const t0 = Date.now();
  const usages: Usage[] = [];

  let data: unknown;
  try {
    const r = await chatJson({
      model,
      schemaName: "scenenote_alignment_v2",
      schema: llmOutputJsonSchema(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT_V2 },
        {
          role: "user",
          content: buildBatchUserMessage({
            projectTitle: opts.context.projectTitle,
            sceneLine: opts.context.sceneLine,
            utts: opts.utts,
            labels,
          }),
        },
      ],
      maxTokens: 24000,
      signal: opts.signal,
    });
    data = r.data;
    usages.push(r.usage);
  } catch (e) {
    if (e instanceof LlmError) {
      throw new AnalysisV2Error(e.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : e.code === "INVALID_OUTPUT" ? "INVALID_OUTPUT" : "LLM_FAILED", e.message);
    }
    throw new AnalysisV2Error("LLM_FAILED", (e as Error).message);
  }

  const parsed = LlmAnalysisOutput.safeParse(data);
  if (!parsed.success) {
    throw new AnalysisV2Error("INVALID_OUTPUT", `LLM 출력이 스키마와 다릅니다: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  }

  const assembled = assembleAll(parsed.data, {
    meetingId: opts.meetingId,
    runId: opts.runId,
    dataMode: opts.dataMode ?? "live",
    utts: opts.utts,
    labels,
    window: null,
  });
  opts.onStage?.({ stage: "llm", raw: parsed.data, labels });
  opts.onStage?.({ stage: "rules", issues: assembled.issues });

  let issues = assembled.issues;
  let contextStats: unknown = undefined;
  if (opts.contextCheck !== false) {
    const cc = await runContextChecks(issues, opts.utts, opts.contextCheck ?? {});
    // 문맥 검사로 떨어진 안건이 있으면 번호를 다시 붙인다(일괄 분석은 번호가 run 안에서만 쓰인다).
    issues = assignIds(cc.issues.map(({ issue_id: _id, ...rest }) => rest), opts.utts);
    usages.push(...cc.usages);
    contextStats = cc.stats;
  }

  return {
    model,
    issues,
    agreements: assembled.agreements,
    stats: { ...assembled.stats, context: contextStats },
    usage: sumUsage(usages),
    latencyMs: Date.now() - t0,
  };
}

/** 저장된 회의를 분석해 run 으로 남긴다. */
export async function runBatchAnalysis(
  meetingId: string,
  opts: { model?: string; contextCheck?: ContextCheckOptions | false; signal?: AbortSignal } = {},
): Promise<BatchResult> {
  const utts = getMeetingUtterances(meetingId);
  if (utts.length === 0) throw new AnalysisV2Error("NO_INPUT", "이 회의에 저장된 발언이 없습니다.");
  const model = opts.model ?? DEFAULT_ANALYSIS_MODEL;
  const runId = beginAnalysisJob(meetingId, model, opts.contextCheck === false ? null : (opts.contextCheck?.model ?? "anthropic/claude-haiku-4.5"), utts);
  const ownership=new AbortController();
  const heartbeat=setInterval(()=>{try{if(!renewAnalysisJob(runId))ownership.abort();}catch{ownership.abort();}},10_000);
  heartbeat.unref?.();
  const signal=AbortSignal.any([ownership.signal,AbortSignal.timeout(600_000),...(opts.signal?[opts.signal]:[])]);
  try {
    const context = getMeetingContext(meetingId);
    const intake = getIntakeMetadata(meetingId);
    const practice = !!intake && intake.source_type !== "actual";
    const r = await analyzeUtterances({ meetingId, runId, utts, context, model, dataMode: practice ? "fixture" : "live", contextCheck: opts.contextCheck, signal });
    // 회의 간 일관성: 같은 작품의 다른 회의에서 승인된 결정과 이번 회의 발언을 대조한다.
    // 실패해도 이 회의의 분석은 살리고, 실패했다는 사실을 stats 에 남긴다.
    let consistency: unknown;
    if (intake) {
      consistency = { skipped: "v2 새 회의는 과거 맥락을 자동으로 가져오지 않음" };
    } else try {
      const c = await checkPastDecisions({ meetingId, projectId: context.projectId, runId, utts, existingIssueIds: r.issues.map((i) => i.issue_id) });
      const w = withdrawConflictingAgreements(r.agreements, c.issues);
      r.agreements = w.agreements;
      const withdrawn = w.withdrawn;
      r.issues = [...r.issues, ...c.issues];
      consistency = { ...c.stats, agreementsWithdrawn: withdrawn };
      if (c.usages.length) {
        const u = sumUsage(c.usages);
        r.usage = {
          calls: r.usage.calls + u.calls,
          promptTokens: r.usage.promptTokens + u.promptTokens,
          completionTokens: r.usage.completionTokens + u.completionTokens,
          costUsd: r.usage.costUsd !== null && u.costUsd !== null ? r.usage.costUsd + u.costUsd : null,
          latencyMs: r.usage.latencyMs + u.latencyMs,
        };
      }
    } catch (e) {
      consistency = { error: (e as Error).message };
    }
    if (practice) {
      r.agreements = [];
      r.issues = r.issues.map(issue => ({...issue, state: "open", condition: null}));
    }
    assertAnalysisJob(runId);
    saveIssues(runId, r.issues);
    finishRun(runId, { status: "completed", latencyMs: r.latencyMs, windowCount: 1, usage: r.usage, stats: { ...r.stats, consistency }, agreements: r.agreements });
    return { runId, ...r, stats: { ...r.stats, consistency } };
  } catch (e) {
    const err = e instanceof AnalysisV2Error ? e : new AnalysisV2Error("LLM_FAILED", (e as Error).message);
    finishRun(runId, { status: "failed", error: `${err.code}: ${err.message}` });
    throw new AnalysisV2Error(err.code, err.message, runId);
  } finally {clearInterval(heartbeat);}
}
