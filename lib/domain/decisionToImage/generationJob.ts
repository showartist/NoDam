// Phase 7D-C(2) — 이미지 생성 Job 계약과 상태 기계.
//
// 순수 함수. **외부 API 를 호출하지 않는다.** 이 모듈은 "호출하면 무슨 일이 벌어져야
// 하는가" 의 계약만 담는다. 실제 provider 연결은 API 키·비용 승인 이후다.
//
// 절대 규칙
//   1. provider 가 연결되지 않은 상태를 성공처럼 표현하지 않는다.
//      succeeded 는 실제 이미지가 생겼을 때만이다.
//   2. 같은 idempotencyKey 로 두 번 큐잉하지 않는다.
//   3. 실패는 사유와 함께 남는다. fixture 이미지로 대체하지 않는다.

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ImageProviderId = "gpt_image" | "midjourney" | "flux";

export type ImageGenerationJob = {
  id: string;
  projectId: string;
  recipeVersionId: string;
  sourceDecisionId: string;
  idempotencyKey: string;

  provider: ImageProviderId;
  model: string;
  prompt: string;
  negativePrompt: string | null;

  state: JobState;
  estimatedImageCount: number;
  actualImageCount: number;
  failureReason: string | null;

  /** 근거 없는 금액을 만들지 않는다 — 매수 기준 추정치이며 단가는 provider 연결 시 확정. */
  costEstimate: number | null;
  actualCost: number | null;

  attempt: number;
  createdAt: string;
  updatedAt: string;
};

// ── 상태 전이 ──────────────────────────────────────────────────────────────

const TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: ["queued"],     // 재시도는 새 시도로 다시 큐잉
  cancelled: ["queued"],  // 취소 후 재요청 허용
};

export type TransitionResult =
  | { ok: true; next: JobState }
  | { ok: false; reason: string };

export function canTransition(from: JobState, to: JobState): TransitionResult {
  if (from === to) return { ok: false, reason: `이미 ${from} 상태입니다.` };
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `${from} → ${to} 전이는 허용되지 않습니다.` };
  }
  return { ok: true, next: to };
}

/**
 * succeeded 로 가려면 실제 이미지가 있어야 한다.
 * provider 미연결 상태에서 "성공" 을 만들 수 없게 하는 지점이다 (규칙 1).
 */
export function completeJob(
  job: ImageGenerationJob,
  outcome:
    | { kind: "succeeded"; actualImageCount: number; actualCost?: number | null }
    | { kind: "failed"; reason: string }
    | { kind: "cancelled"; reason?: string },
): TransitionResult & { job?: ImageGenerationJob } {
  const target: JobState =
    outcome.kind === "succeeded" ? "succeeded" : outcome.kind === "failed" ? "failed" : "cancelled";
  const t = canTransition(job.state, target);
  if (!t.ok) return t;

  if (outcome.kind === "succeeded") {
    if (outcome.actualImageCount <= 0) {
      return {
        ok: false,
        reason: "이미지가 0장인데 succeeded 로 만들 수 없습니다. 실패로 기록하십시오.",
      };
    }
    return {
      ok: true, next: target,
      job: {
        ...job, state: target,
        actualImageCount: outcome.actualImageCount,
        actualCost: outcome.actualCost ?? null,
        failureReason: null,
      },
    };
  }

  if (outcome.kind === "failed") {
    if (!outcome.reason.trim()) {
      return { ok: false, reason: "실패에는 사유가 필요합니다." };
    }
    return {
      ok: true, next: target,
      job: { ...job, state: target, failureReason: outcome.reason.trim(), actualImageCount: 0 },
    };
  }

  return {
    ok: true, next: target,
    job: { ...job, state: target, failureReason: outcome.reason?.trim() ?? "사용자 취소" },
  };
}

// ── 큐잉 게이트 ────────────────────────────────────────────────────────────

export type ProviderAvailability = {
  provider: ImageProviderId;
  /** API 키·연결이 실제로 준비됐는가. 현재는 전부 false. */
  connected: boolean;
  reason?: string;
};

export type QueueRequest = {
  idempotencyKey: string;
  provider: ImageProviderId;
  estimatedImageCount: number;
  /** 이미 존재하는 같은 키의 Job (있으면 재사용) */
  existingJob?: ImageGenerationJob | null;
  availability: ProviderAvailability;
  limits: { perDecisionMax: number; meetingRemaining: number };
};

export type QueueDecision =
  | { action: "reuse_existing"; jobId: string; reason: string }
  | { action: "queue"; estimatedImageCount: number }
  | { action: "blocked"; reasons: string[] };

/**
 * 큐잉 가부 판정.
 * provider 미연결이어도 **Job 은 queued 로 만들 수 있다** — 계약과 UI 를 먼저 검증하기
 * 위해서다. 다만 그 사실을 반드시 표시하도록 사유를 함께 돌려준다.
 */
export function decideQueueing(req: QueueRequest): QueueDecision {
  if (req.existingJob) {
    return {
      action: "reuse_existing",
      jobId: req.existingJob.id,
      reason: "같은 Recipe 버전·모델·프롬프트로 이미 생성 요청이 있습니다. 중복 생성하지 않습니다.",
    };
  }

  const reasons: string[] = [];
  if (req.estimatedImageCount <= 0) reasons.push("생성 매수가 1장 이상이어야 합니다.");
  if (req.estimatedImageCount > req.limits.perDecisionMax) {
    reasons.push(`결정 1건당 최대 ${req.limits.perDecisionMax}장입니다.`);
  }
  if (req.estimatedImageCount > req.limits.meetingRemaining) {
    reasons.push(`이번 회의 잔여 생성 한도(${req.limits.meetingRemaining}장)를 초과합니다.`);
  }
  if (reasons.length) return { action: "blocked", reasons };

  return { action: "queue", estimatedImageCount: req.estimatedImageCount };
}

/** 현재 연결 상태. provider 를 붙이기 전까지 전부 미연결이다. */
export const PROVIDER_AVAILABILITY: Record<ImageProviderId, ProviderAvailability> = {
  gpt_image: { provider: "gpt_image", connected: false, reason: "API 키·비용 승인 전입니다." },
  midjourney: { provider: "midjourney", connected: false, reason: "공식 API 가 없어 연결 방식 미정입니다." },
  flux: { provider: "flux", connected: false, reason: "API 키·비용 승인 전입니다." },
};

export const anyProviderConnected = () =>
  Object.values(PROVIDER_AVAILABILITY).some((p) => p.connected);
