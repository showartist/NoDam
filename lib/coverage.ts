// Coverage gap 해결 — 감독이 고른 안을 적용하고 순서·Previs·제작 영향을 갱신한다.
// Shot Board 는 6컷 고정이 아니므로 Insert 는 개수를 늘리고 뒤 번호를 민다.
import { db, now, recordVersion, uid } from "./db";
import {
  claimCoverage,
  computeProductionImpacts,
  evaluateCoverage,
  getCoverageLinks,
  getIntents,
  reviewLastImageOnOrderChange,
} from "./intents";
import type { ShotRow } from "./store";
import {
  SHOT_COUNT_RECOMMENDED_MAX,
  type CoverageActionKey,
  type CoverageRole,
  type IntentType,
  type SceneIntent,
} from "./types";

const plain = <T,>(rows: unknown[]) => rows.map((r) => ({ ...(r as object) })) as T[];
const plainOne = <T,>(row: unknown) => (row ? ({ ...(row as object) } as T) : undefined);

export type { IntentCoverageReport } from "./intents";

/** 현재 열려 있는 커버리지 문제만 추린다. */
export function detectCoverageGaps(meetingId: string) {
  const d = db();
  const shots = plain<ShotRow>(
    d.prepare(`SELECT * FROM shots WHERE meeting_id = ? ORDER BY shot_number`).all(meetingId),
  );
  return evaluateCoverage(getIntents(meetingId), getCoverageLinks(meetingId), shots).filter(
    (r) => r.status !== "covered",
  );
}

export type CoverageFixInput = {
  meetingId: string;
  intentId: string;
  action: CoverageActionKey;
  /** replace_shot 일 때 대상 쇼트 번호 */
  targetShotNumber?: number;
  /** insert_shot 일 때 이 번호 뒤에 넣는다. 없으면 맨 뒤. */
  afterShotNumber?: number;
  role?: CoverageRole;
  actor?: string;
};

/**
 * 감독이 고른 해결안을 적용한다.
 * 쇼트 번호를 미는 작업은 원자적이어야 하므로 트랜잭션 안에서 처리한다.
 * 실패하면 롤백되어 순서가 어긋난 채 남지 않는다.
 */
export function applyCoverageFix(input: CoverageFixInput) {
  const d = db();
  const { meetingId, intentId, action } = input;
  const actor = input.actor ?? "current_user";
  const role: CoverageRole = input.role ?? "director";
  const ts = now();

  const intent = plainOne<SceneIntent>(
    d.prepare(`SELECT * FROM scene_intents WHERE meeting_id = ? AND id = ?`).get(meetingId, intentId),
  );
  if (!intent) return null;
  const theIntent: SceneIntent = intent;

  const shotsBefore = plain<ShotRow>(
    d.prepare(`SELECT * FROM shots WHERE meeting_id = ? ORDER BY shot_number`).all(meetingId),
  );

  if ((action as string) === "add_shot" && shotsBefore.length >= SHOT_COUNT_RECOMMENDED_MAX) {
    return {
      ok: false as const,
      summary: `권장 최대 ${SHOT_COUNT_RECOMMENDED_MAX}컷을 넘습니다. 기존 쇼트 교체를 검토하세요.`,
    };
  }

  d.exec("BEGIN");
  let result: { ok: true; summary: string; shotCountDelta: number; orderChanged: boolean };
  try {
    result = apply();
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }

  // 커밋 이후에 파생 상태를 갱신한다.
  const orderReviewed = reviewLastImageOnOrderChange(meetingId);
  const impacts = computeProductionImpacts({
    shotCountDelta: result.shotCountDelta,
    intentTypes: [theIntent.type as IntentType],
    orderChanged: result.orderChanged,
  });
  writeImpacts(meetingId, intentId, impacts as any, ts);

  const shotsAfter = plain<ShotRow>(
    d.prepare(`SELECT * FROM shots WHERE meeting_id = ? ORDER BY shot_number`).all(meetingId),
  );
  recordVersion(meetingId, "coverage.resolved", intentId, {
    action,
    actor,
    summary: result.summary,
    before: shotsBefore,
    after: shotsAfter,
    impacts,
    orderReviewed,
  });

  return { ok: true as const, summary: result.summary, impacts, orderReviewed, action };

  function apply() {
    if ((action as string) === "add_shot" || (action as string) === "insert_shot") {
      const after = input.afterShotNumber ?? Math.max(0, ...shotsBefore.map((s) => s.shot_number));
      const at = after + 1;
      d.prepare(
        `UPDATE shots SET shot_number = shot_number + 1, updated_at = ?
          WHERE meeting_id = ? AND shot_number >= ?`,
      ).run(ts, meetingId, at);

      const shotId = uid();
      d.prepare(
        `INSERT INTO shots
           (id, meeting_id, shot_number, shot_size, image_url, lens, camera_height, camera_move,
            character_action, dialogue_sound, duration, purpose, production_check, evidence, covers,
            is_representative, status, version, updated_at)
         VALUES (?, ?, ?, 'INSERT', '/images/shot_insert.svg', '85mm', '로우 앵글', '고정',
                 ?, '대사 없음.', '미정',
                 ?, '추가 촬영 1컷. 촬영 시간과 비용은 제작PD 확인 필요.',
                 ?, '[]', 0, 'review', 1, ?)`,
      ).run(
        shotId,
        meetingId,
        at,
        theIntent.text,
        `${theIntent.type === "key_object" ? "핵심 오브제" : "핵심 행동"}를 화면에 담는다.`,
        JSON.stringify(theIntent.evidence),
        ts,
      );
      claimCoverage(meetingId, shotId, intentId, role, actor);
      return {
        ok: true as const,
        summary: `쇼트 ${at}에 Insert Shot을 추가했습니다. 총 ${shotsBefore.length + 1}컷.`,
        shotCountDelta: 1,
        orderChanged: true,
      };
    }

    if ((action as string) === "modify_shot" || (action as string) === "replace_shot") {
      const target = shotsBefore.find((s) => s.shot_number === input.targetShotNumber);
      if (!target) throw new Error("교체 대상 쇼트를 찾을 수 없습니다.");
      d.prepare(
        `UPDATE shots SET character_action = ?, purpose = ?, status = 'review',
             version = version + 1, approved_by = NULL, approved_at = NULL, updated_at = ?
          WHERE id = ?`,
      ).run(theIntent.text, `${theIntent.text} — 의도를 화면에 담는다.`, ts, target.id);
      claimCoverage(meetingId, target.id, intentId, role, actor);
      return {
        ok: true as const,
        summary: `쇼트 ${target.shot_number}을(를) 이 의도로 교체했습니다. 총 ${shotsBefore.length}컷 유지.`,
        shotCountDelta: 0,
        orderChanged: false,
      };
    }

    // drop_intent
    d.prepare(
      `UPDATE scene_intents SET decision_state = 'rejected', updated_at = ? WHERE id = ? AND meeting_id = ?`,
    ).run(ts, intentId, meetingId);
    d.prepare(
      `UPDATE shot_coverage SET coverage_verification_state = 'rejected', updated_at = ?
        WHERE meeting_id = ? AND intent_id = ?`,
    ).run(ts, meetingId, intentId);
    return {
      ok: true as const,
      summary: `의도 "${theIntent.text}"를 Scene Brief에서 내렸습니다. 관련 Scene Brief 항목을 다시 확인하세요.`,
      shotCountDelta: 0,
      orderChanged: false,
    };
  }
}

function writeImpacts(
  meetingId: string,
  intentId: string,
  impacts: { area: string; level: string; detail: string }[],
  ts: string,
) {
  const d = db();
  d.prepare(`DELETE FROM asset_impacts WHERE meeting_id = ? AND issue_id = ?`).run(meetingId, intentId);
  const ins = d.prepare(
    `INSERT INTO asset_impacts (id, meeting_id, issue_id, asset_type, target_id, label, status, action, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const im of impacts) {
    ins.run(
      uid(),
      meetingId,
      intentId,
      "production",
      im.area,
      `${im.area} — ${im.detail}`,
      im.level === "영향 없음" ? "current" : "stale",
      im.level,
      ts,
    );
  }
}
