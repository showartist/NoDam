// Film Intent Coverage — Scene Brief 의 의도가 Shot Board 에 실제로 담겼는지 검사한다.
//   감독: 의도한 행동/이미지가 화면에 있는가
//   작가: 대사가 아닌 행동과 오브제로 전달되는가
//   제작PD: 추가 촬영·소품·조명 확인이 필요한가
//
// 원칙
//   1. AI 가 covers_intents 를 제안해도 자동으로 verified 가 되지 않는다.
//   2. 근거가 없으면 숫자를 만들지 않는다. 방향과 확인 주체만 표시한다.
//   3. 카메라 방향 같은 연출 값이 바뀌었다고 커버리지를 자동으로 깨뜨리지 않는다.
import { db, now, recordVersion, uid } from "./db";
import type { ShotRow } from "./store";
import {
  coverageRoleDisplayLabel,
  INTENT_LABEL,
  type CoverageFunction,
  type CoverageLink,
  type CoverageRole,
  type CoverageStatus,
  type CoverageVerificationState,
  type IntentType,
  type ProductionImpact,
  type SceneIntent,
} from "./types";

const plain = <T,>(rows: unknown[]) => rows.map((r) => ({ ...(r as object) })) as T[];
const plainOne = <T,>(row: unknown) => (row ? ({ ...(row as object) } as T) : undefined);

export function getIntents(meetingId: string) {
  return plain<SceneIntent>(
    db().prepare(`SELECT * FROM scene_intents WHERE meeting_id = ? ORDER BY type`).all(meetingId),
  );
}

export function getCoverageLinks(meetingId: string) {
  return plain<CoverageLink>(
    db().prepare(`SELECT * FROM shot_coverage WHERE meeting_id = ?`).all(meetingId),
  );
}

// ── 검사 결과 ─────────────────────────────────────────────────────

export type IntentCoverageReport = {
  intent: SceneIntent;
  status: CoverageStatus;
  /** 이 의도를 담는다고 주장된 샷들 */
  claims: {
    link: CoverageLink;
    shot_number: number;
    shot_size: string;
    role: CoverageLink["role"];
    role_label: string;
  }[];
  verified_shots: number[];
  /** key_object 전용 — 설정/강조/회수 중 빠진 단계 */
  missing_stages: CoverageFunction[];
  /** last_image 전용 — 종료부 순서에 있는가 */
  ending_shot_number: number | null;
  message: string;
};

const ACTIVE = new Set(["draft", "review", "approved", "restale"]);

/** 종료부 = 현재 살아 있는 샷 중 가장 마지막 번호. */
function endingShotNumber(shots: ShotRow[]): number | null {
  const active = shots.filter((s) => ACTIVE.has(s.status));
  if (!active.length) return null;
  return Math.max(...active.map((s) => s.shot_number));
}

export function evaluateCoverage(
  intents: SceneIntent[],
  links: CoverageLink[],
  shots: ShotRow[],
): IntentCoverageReport[] {
  const shotById = new Map(shots.map((s) => [s.id, s]));
  const ending = endingShotNumber(shots);

  return intents
    .filter((i) => i.decision_state !== "rejected" && i.decision_state !== "superseded")
    .map((intent) => {
      const mine = links.filter((l) => l.intent_id === intent.id);
      const claims = mine
        .map((link) => {
          const shot = shotById.get(link.shot_id);
          return shot
            ? {
                link,
                shot_number: shot.shot_number,
                shot_size: shot.shot_size,
                role: link.role,
                role_label: coverageRoleDisplayLabel(link.role),
              }
            : null;
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => a.shot_number - b.shot_number);

      const verified = claims.filter((c) => (c.link.coverage_verification_state as string) === "verified" || c.link.coverage_verification_state === "approved");
      const live = claims.filter((c) => c.link.coverage_verification_state !== "rejected");

      let status: CoverageStatus;
      let message: string;
      const missing_stages: CoverageFunction[] = [];

      if (live.length === 0) {
        status = "missing";
        message = `${INTENT_LABEL[intent.type]}을(를) 담는 쇼트가 없습니다.`;
      } else if (verified.length === 0) {
        status = "partial";
        message = `쇼트 ${live.map((c) => c.shot_number).join(", ")}이(가) 제안되었지만 감독 확인 전입니다.`;
      } else {
        status = "covered";
        message = `쇼트 ${verified.map((c) => c.shot_number).join(", ")}에서 확인되었습니다.`;
      }

      // last_image — 종료부 순서에 실제로 있는지까지 본다.
      if (intent.type === "last_image" && status === "covered" && ending !== null) {
        const atEnd = verified.some((c) => c.shot_number === ending);
        if (!atEnd) {
          status = "partial";
          message = `쇼트 ${verified.map((c) => c.shot_number).join(", ")}에 담겨 있지만 종료부(쇼트 ${ending})가 아닙니다. 순서를 확인하세요.`;
        }
      }

      // key_object — 설정 · 강조 · 회수 흐름 추적. 이 세 값은 shot_coverage.role 이 실제로 담는
      // coverage-function 값이다(부서 역할이 아니다) — CoverageFunction 참고.
      if (intent.type === "key_object") {
        for (const stage of ["setup", "emphasis", "payoff"] as CoverageFunction[]) {
          if (!live.some((c) => c.role === stage)) missing_stages.push(stage);
        }
        if (missing_stages.length && status !== "missing") {
          status = "partial";
          message = `${missing_stages.map((s) => coverageRoleDisplayLabel(s)).join(" · ")} 단계가 비어 있습니다.`;
        }
      }

      const stale = live.filter((c) => (c.link.coverage_verification_state as string) === "stale");
      if (stale.length) {
        status = "partial";
        message = "의도가 변경되어 샷 재검토가 필요합니다.";
      }

      return {
        intent,
        status,
        claims,
        verified_shots: verified.map((c) => c.shot_number),
        missing_stages,
        ending_shot_number: ending,
        message,
      };
    });
}

// ── 감독 승인 ─────────────────────────────────────────────────────

/** AI 주장을 사람이 확인한다. verified 는 여기서만 부여된다. */
export function verifyCoverage(
  linkId: string,
  state: CoverageVerificationState,
  actor = "current_user",
) {
  const d = db();
  const before = plainOne<CoverageLink>(
    d.prepare(`SELECT * FROM shot_coverage WHERE id = ?`).get(linkId),
  );
  if (!before) return null;

  const intent = plainOne<SceneIntent>(
    d
      .prepare(`SELECT * FROM scene_intents WHERE id = ? AND meeting_id = ?`)
      .get(before.intent_id, before.meeting_id),
  );
  const ts = now();

  d.prepare(
    `UPDATE shot_coverage
        SET coverage_verification_state = ?, coverage_approved_by = ?, coverage_approved_at = ?,
            intent_version = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    state,
    (state as string) === "verified" || state === "approved" ? actor : null,
    (state as string) === "verified" || state === "approved" ? ts : null,
    intent?.version ?? before.intent_version,
    ts,
    linkId,
  );

  const after = plainOne<CoverageLink>(
    d.prepare(`SELECT * FROM shot_coverage WHERE id = ?`).get(linkId),
  )!;
  recordVersion(before.meeting_id, "coverage.verified", linkId, { before, after, actor, state });
  return after;
}

// ── 의도 변경 · 순서 변경에 따른 재검토 ─────────────────────────────

/**
 * Scene Brief 의도가 바뀌면 버전을 올리고, 그 전에 확인된 커버리지를 stale 로 만든다.
 * 카메라 방향 같은 다른 연출 값 변경으로는 호출하지 않는다.
 */
export function bumpIntent(
  meetingId: string,
  intentId: string,
  text: string,
  actor = "current_user",
) {
  const d = db();
  const before = plainOne<SceneIntent>(
    d.prepare(`SELECT * FROM scene_intents WHERE id = ? AND meeting_id = ?`).get(intentId, meetingId),
  );
  if (!before) return null;
  if (before.text.trim() === text.trim()) return before;

  const ts = now();
  const version = before.version + 1;
  d.prepare(
    `UPDATE scene_intents SET text = ?, version = ?, updated_at = ? WHERE id = ? AND meeting_id = ?`,
  ).run(text, version, ts, intentId, meetingId);
  // 이전 버전 기준으로 확인된 주장은 더 이상 유효하지 않다.
  d.prepare(
    `UPDATE shot_coverage
        SET coverage_verification_state = 'stale', updated_at = ?
      WHERE meeting_id = ? AND intent_id = ? AND intent_version < ?
        AND coverage_verification_state IN ('verified', 'proposed', 'needs_review')`,
  ).run(ts, meetingId, intentId, version);

  const after = plainOne<SceneIntent>(
    d.prepare(`SELECT * FROM scene_intents WHERE id = ? AND meeting_id = ?`).get(intentId, meetingId),
  )!;
  recordVersion(meetingId, "intent.changed", intentId, { before, after, actor });
  return after;
}

/**
 * 쇼트 순서가 바뀌면 last_image 커버리지를 재확인 대상으로 돌린다.
 * 종료부에 그대로 있으면 건드리지 않는다.
 */
export function reviewLastImageOnOrderChange(meetingId: string) {
  const d = db();
  const shots = plain<ShotRow>(
    d.prepare(`SELECT * FROM shots WHERE meeting_id = ? ORDER BY shot_number`).all(meetingId),
  );
  const ending = endingShotNumber(shots);
  if (ending === null) return 0;

  const lastImage = plainOne<SceneIntent>(
    d
      .prepare(`SELECT * FROM scene_intents WHERE meeting_id = ? AND type = 'last_image' LIMIT 1`)
      .get(meetingId),
  );
  if (!lastImage) return 0;

  const links = plain<CoverageLink>(
    d.prepare(`SELECT * FROM shot_coverage WHERE meeting_id = ? AND intent_id = ?`).all(meetingId, lastImage.id),
  );
  const shotById = new Map(shots.map((s) => [s.id, s]));
  const ts = now();
  let touched = 0;

  for (const link of links) {
    const shot = shotById.get(link.shot_id);
    if (!shot) continue;
    const atEnd = shot.shot_number === ending;
    if (!atEnd && ((link.coverage_verification_state as string) === "verified" || link.coverage_verification_state === "approved")) {
      d.prepare(
        `UPDATE shot_coverage SET coverage_verification_state = 'needs_review', updated_at = ? WHERE id = ?`,
      ).run(ts, link.id);
      touched++;
    }
  }
  if (touched) {
    recordVersion(meetingId, "coverage.order_review", lastImage.id, { ending, touched });
  }
  return touched;
}

// ── 제작 영향 ─────────────────────────────────────────────────────

/**
 * 커버리지 변화가 제작에 미치는 영향.
 * 정확한 비용·촬영 시간을 계산할 근거가 없으므로 숫자를 만들지 않는다.
 */
export function computeProductionImpacts(input: {
  shotCountDelta: number;
  intentTypes: IntentType[];
  orderChanged: boolean;
}): ProductionImpact[] {
  const { shotCountDelta, intentTypes, orderChanged } = input;
  const impacts: any[] = [
    { area: "Shot Board", level: "재검토 필요", detail: "쇼트 구성이 바뀌었습니다." },
    {
      area: "Previs",
      level: "재검토 필요",
      detail: orderChanged ? "쇼트 순서가 바뀌어 다시 만들어야 합니다." : "구성 변경분을 반영해야 합니다.",
    },
  ];

  if (shotCountDelta > 0) {
    impacts.push({
      area: "촬영 분량",
      level: "증가 가능성",
      detail: `쇼트 ${shotCountDelta}개 추가. 정확한 촬영 시간은 콘티와 리허설 후 산출됩니다.`,
    });
    impacts.push({
      area: "조명 · 카메라",
      level: "제작PD 확인 필요",
      detail: "추가 컷의 렌즈·앵글·조명 세팅이 기존 세팅으로 커버되는지 확인이 필요합니다.",
    });
  } else if (shotCountDelta < 0) {
    impacts.push({
      area: "촬영 분량",
      level: "제작PD 확인 필요",
      detail: `쇼트 ${Math.abs(shotCountDelta)}개 감소. 스케줄 재산출이 필요합니다.`,
    });
  } else {
    impacts.push({
      area: "촬영 분량",
      level: "영향 없음",
      detail: "쇼트 개수는 그대로입니다.",
    });
  }

  if (intentTypes.includes("key_object")) {
    impacts.push({
      area: "소품 연속성",
      level: "제작PD 확인 필요",
      detail: "핵심 오브제가 등장하는 다른 씬과의 상태 연속성을 확인해야 합니다.",
    });
  }
  if (intentTypes.includes("key_action")) {
    impacts.push({
      area: "배우 행동",
      level: "제작PD 확인 필요",
      detail: "핵심 행동의 동선과 리허설 시간이 필요합니다.",
    });
  }

  impacts.push({
    area: "제작PD 전달 사항",
    level: "제작PD 확인 필요",
    detail: "위 항목을 확인한 뒤 촬영 계획에 반영하세요. 비용은 확인 전까지 산출하지 않습니다.",
  });

  return impacts;
}

/** 대표 컷 자동 선정 — 처음·마지막을 포함해 고르게 분포시킨다. */
export function pickRepresentative(shots: ShotRow[], count: number): string[] {
  const active = shots.filter((s) => ACTIVE.has(s.status)).sort((a, b) => a.shot_number - b.shot_number);
  if (active.length <= count) return active.map((s) => s.id);
  const picked = new Set<string>([active[0].id, active[active.length - 1].id]);
  const step = (active.length - 1) / (count - 1);
  for (let i = 1; i < count - 1 && picked.size < count; i++) {
    picked.add(active[Math.round(i * step)].id);
  }
  // 반올림 충돌로 모자라면 앞에서부터 채운다.
  for (const s of active) {
    if (picked.size >= count) break;
    picked.add(s.id);
  }
  return [...picked];
}

export function setRepresentative(meetingId: string, shotIds: string[]) {
  const d = db();
  const ts = now();
  d.prepare(`UPDATE shots SET is_representative = 0, updated_at = ? WHERE meeting_id = ?`).run(ts, meetingId);
  const upd = d.prepare(`UPDATE shots SET is_representative = 1, updated_at = ? WHERE id = ? AND meeting_id = ?`);
  for (const id of shotIds) upd.run(ts, id, meetingId);
  recordVersion(meetingId, "shots.representative", null, { shotIds });
  return shotIds.length;
}

export function toggleRepresentative(shotId: string) {
  const d = db();
  const shot = plainOne<ShotRow & { is_representative: number }>(
    d.prepare(`SELECT * FROM shots WHERE id = ?`).get(shotId),
  );
  if (!shot) return null;
  const next = shot.is_representative ? 0 : 1;
  d.prepare(`UPDATE shots SET is_representative = ?, updated_at = ? WHERE id = ?`).run(next, now(), shotId);
  recordVersion(shot.meeting_id, "shots.representative_toggled", shotId, { next });
  return next === 1;
}

/** 커버리지 주장 추가 — AI 든 사람이든 항상 proposed 로 들어온다. */
export function claimCoverage(
  meetingId: string,
  shotId: string,
  intentId: string,
  role: CoverageRole = "director",
  claimedBy = "ai",
) {
  const d = db();
  const intent = plainOne<SceneIntent>(
    d.prepare(`SELECT * FROM scene_intents WHERE id = ? AND meeting_id = ?`).get(intentId, meetingId),
  );
  d.prepare(
    `INSERT INTO shot_coverage
       (id, meeting_id, shot_id, intent_id, role, coverage_claimed_by,
        coverage_verification_state, intent_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
     ON CONFLICT(shot_id, intent_id, role) DO UPDATE SET
       coverage_verification_state = 'proposed',
       coverage_claimed_by = excluded.coverage_claimed_by,
       coverage_approved_by = NULL, coverage_approved_at = NULL,
       intent_version = excluded.intent_version,
       updated_at = excluded.updated_at`,
  ).run(uid(), meetingId, shotId, intentId, role, claimedBy, intent?.version ?? 1, now());
}

// ── Intent Coverage 뷰모델 ────────────────────────────────────────
// page.tsx 가 세 값을 따로 넘기다 하나를 빠뜨리면 패널이 조용히 빈 채로 렌더된다.
// 하나의 완성된 뷰모델로 묶어 그런 배선 회귀를 구조적으로 막는다.
export type IntentCoverageViewModel = {
  reports: IntentCoverageReport[];
  gaps: IntentCoverageReport[];
  productionImpacts: {
    id: string;
    target_id: string;
    label: string;
    status: string;
    action: string;
  }[];
  /** 조회가 실패했는가 — 빈 데이터와 장애를 구분한다. */
  loadError: string | null;
};

export function buildIntentCoverageViewModel(
  meetingId: string,
  shots: ShotRow[],
): IntentCoverageViewModel {
  try {
    const reports = evaluateCoverage(getIntents(meetingId), getCoverageLinks(meetingId), shots);
    const productionImpacts = plain<IntentCoverageViewModel["productionImpacts"][number]>(
      db()
        .prepare(
          `SELECT id, target_id, label, status, action FROM asset_impacts
            WHERE meeting_id = ? AND asset_type = 'production' ORDER BY updated_at DESC`,
        )
        .all(meetingId),
    );
    return {
      reports,
      gaps: reports.filter((r) => r.status !== "covered"),
      productionImpacts,
      loadError: null,
    };
  } catch (e) {
    // 빈 배열로 위장하지 않는다. 화면이 "불러오지 못했습니다"를 보여줘야 한다.
    return { reports: [], gaps: [], productionImpacts: [], loadError: (e as Error).message };
  }
}
