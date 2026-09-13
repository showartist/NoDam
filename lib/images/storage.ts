/**
 * 생성 이미지 저장소 (generated_images 표 + .data/images/ 파일). 서버 전용.
 *
 * 상태: generating → completed | failed
 *   - 실패하면 오류를 남기고 끝낸다. 다른 이미지로 대신하지 않는다.
 *   - completed 는 실제 파일이 디스크에 쓰인 뒤에만 된다.
 *
 * 생성 상한 (lib/domain/imageGeneration/types.ts)
 *   MAX_IMAGES_PER_MEETING  = 6  회의 하나에서 generating + completed 행 수(캐릭터 컨셉 초안은 빼고 인물마다 따로 센다)
 *   MAX_IMAGES_PER_DECISION = 2  같은 대상(안건 + 그림 종류 + 화자)에서 generating + completed 행 수.
 *                                 "X 의 관점 그림", "합의안 그림"이 각각 한 대상이다.
 *                                 draft 와 final 을 한 장씩 만들 수 있는 크기다.
 *   실패 행은 세지 않는다. SCENENOTE_IMAGE_QUOTA_OVERRIDE=1 이면 검사하지 않는다(평가 스크립트용).
 *   상한 검사와 행 추가는 한 트랜잭션(BEGIN IMMEDIATE)이다. 동시 요청이 함께 통과하지 못한다.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, now, uid } from "../db";
import { MAX_IMAGES_PER_DECISION, MAX_IMAGES_PER_MEETING } from "../domain/imageGeneration/types";
import { ImageGenError } from "./errors";
import { EXT_BY_MEDIA, type ImageMediaType } from "./imageBytes";
import { imagesDir, toStoredPath } from "./paths";
import type { ImageKind } from "./recipeFromPosition";
import type { ImageResolution } from "./openrouterImages";

/** 이 시간이 지나도 generating 인 행은 서버가 멈춘 것으로 보고 실패 처리한다(상한을 영구히 잡아먹지 않게). */
const STALE_GENERATING_MS = 15 * 60 * 1000;

export type ImageStatus = "generating" | "completed" | "failed";

type Row = {
  id: string;
  meeting_id: string;
  run_id: string | null;
  issue_id: string | null;
  kind: string;
  speaker_key: string | null;
  model: string;
  prompt: string;
  negative: string | null;
  reference_ids: string;
  evidence_uids: string;
  resolution: string;
  status: string;
  error: string | null;
  file_path: string | null;
  width: number | null;
  height: number | null;
  similarity_json: string | null;
  cost_usd: number | null;
  created_at: string;
  finished_at: string | null;
};

export type GeneratedImage = {
  id: string;
  meetingId: string;
  runId: string | null;
  issueId: string | null;
  kind: string;
  speakerKey: string | null;
  model: string;
  prompt: string;
  negative: string[];
  referenceIds: string[];
  evidenceUids: string[];
  resolution: string;
  status: ImageStatus;
  error: string | null;
  filePath: string | null;
  width: number | null;
  height: number | null;
  similarity: unknown;
  costUsd: number | null;
  createdAt: string;
  finishedAt: string | null;
  /** completed 일 때만 있다 */
  url: string | null;
};

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function toImage(r: Row): GeneratedImage {
  return {
    id: r.id,
    meetingId: r.meeting_id,
    runId: r.run_id,
    issueId: r.issue_id,
    kind: r.kind,
    speakerKey: r.speaker_key,
    model: r.model,
    prompt: r.prompt,
    negative: parseJson<string[]>(r.negative, []),
    referenceIds: parseJson<string[]>(r.reference_ids, []),
    evidenceUids: parseJson<string[]>(r.evidence_uids, []),
    resolution: r.resolution,
    status: r.status as ImageStatus,
    error: r.error,
    filePath: r.file_path,
    width: r.width,
    height: r.height,
    similarity: parseJson<unknown>(r.similarity_json, null),
    costUsd: r.cost_usd,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    url: r.status === "completed" && r.file_path ? `/api/images/${r.id}` : null,
  };
}

export function getImage(id: string): GeneratedImage | null {
  const r = db().prepare(`SELECT * FROM generated_images WHERE id = ?`).get(id) as unknown as Row | undefined;
  return r ? toImage(r) : null;
}

export function listImages(meetingId: string, opts: { issueId?: string | null } = {}): GeneratedImage[] {
  const rows = opts.issueId
    ? db()
        .prepare(`SELECT * FROM generated_images WHERE meeting_id = ? AND issue_id = ? ORDER BY created_at DESC`)
        .all(meetingId, opts.issueId)
    : db().prepare(`SELECT * FROM generated_images WHERE meeting_id = ? ORDER BY created_at DESC`).all(meetingId);
  return (rows as unknown as Row[]).map(toImage);
}

// ── 상한 ────────────────────────────────────────────────────────────────────

export type ImageTarget = {
  meetingId: string;
  issueId: string | null;
  kind: ImageKind | string;
  speakerKey: string | null;
};

export type QuotaStatus = {
  overridden: boolean;
  meeting: { used: number; limit: number };
  decision: { used: number; limit: number } | null;
};

export const quotaOverridden = () => process.env.SCENENOTE_IMAGE_QUOTA_OVERRIDE === "1";

/** 오래된 generating 행을 실패로 닫는다. */
export function sweepStaleGenerating(): number {
  const cutoff = new Date(Date.now() - STALE_GENERATING_MS).toISOString();
  const r = db()
    .prepare(
      `UPDATE generated_images SET status = 'failed', error = ?, finished_at = ?
        WHERE status = 'generating' AND created_at < ?`,
    )
    .run("INTERRUPTED: 생성 중 서버가 멈춰 결과가 없습니다.", now(), cutoff);
  return Number(r.changes ?? 0);
}

export function quotaStatus(target: ImageTarget): QuotaStatus {
  const d = db();
  const meetingUsed = (
    d
      // 캐릭터 컨셉 초안(kind=character)은 작품 단위라 회의 한도에 넣지 않는다. 인물마다 따로 막는다(lib/characters).
      .prepare(`SELECT COUNT(*) AS n FROM generated_images WHERE meeting_id = ? AND kind <> 'character' AND status IN ('generating','completed')`)
      .get(target.meetingId) as { n: number }
  ).n;
  const decisionUsed = target.issueId
    ? (
        d
          .prepare(
            `SELECT COUNT(*) AS n FROM generated_images
              WHERE meeting_id = ? AND issue_id = ? AND kind = ? AND COALESCE(speaker_key, '') = ?
                AND status IN ('generating','completed')`,
          )
          .get(target.meetingId, target.issueId, target.kind, target.speakerKey ?? "") as { n: number }
      ).n
    : null;
  return {
    overridden: quotaOverridden(),
    meeting: { used: meetingUsed, limit: MAX_IMAGES_PER_MEETING },
    decision: decisionUsed === null ? null : { used: decisionUsed, limit: MAX_IMAGES_PER_DECISION },
  };
}

export type ReserveInput = {
  target: ImageTarget;
  runId: string | null;
  model: string;
  prompt: string;
  negative: string[];
  referenceIds: string[];
  evidenceUids: string[];
  resolution: ImageResolution;
};

/**
 * 상한을 검사하고 generating 행을 만든다. 넘으면 QUOTA_EXCEEDED.
 */
export function reserveImage(input: ReserveInput): GeneratedImage {
  const d = db();
  const id = `img_${uid()}`;
  d.exec("BEGIN IMMEDIATE");
  try {
    sweepStaleGenerating();
    if (!quotaOverridden()) {
      const q = quotaStatus(input.target);
      if (q.decision && q.decision.used >= q.decision.limit) {
        throw new ImageGenError(
          "QUOTA_EXCEEDED",
          `같은 대상의 이미지는 ${q.decision.limit}장까지입니다 (이미 ${q.decision.used}장).`,
          { detail: { scope: "decision", ...q.decision } },
        );
      }
      if (q.meeting.used >= q.meeting.limit && input.target.kind !== "character") {
        throw new ImageGenError(
          "QUOTA_EXCEEDED",
          `이 회의의 이미지는 ${q.meeting.limit}장까지입니다 (이미 ${q.meeting.used}장).`,
          { detail: { scope: "meeting", ...q.meeting } },
        );
      }
    }
    d.prepare(
      `INSERT INTO generated_images
         (id, meeting_id, run_id, issue_id, kind, speaker_key, model, prompt, negative,
          reference_ids, evidence_uids, resolution, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.target.meetingId,
      input.runId,
      input.target.issueId,
      input.target.kind,
      input.target.speakerKey,
      input.model,
      input.prompt,
      JSON.stringify(input.negative),
      JSON.stringify(input.referenceIds),
      JSON.stringify(input.evidenceUids),
      input.resolution,
      "generating",
      now(),
    );
    d.exec("COMMIT");
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    throw e;
  }
  return getImage(id)!;
}

/** 바이트를 파일로 쓴다. 임시 파일에 쓰고 이름을 바꿔 반쯤 쓴 파일이 남지 않게 한다. */
export function writeImageFile(name: string, bytes: Uint8Array, mediaType: ImageMediaType): { absPath: string; storedPath: string } {
  const dir = imagesDir();
  mkdirSync(dir, { recursive: true });
  const absPath = path.join(dir, `${name}.${EXT_BY_MEDIA[mediaType]}`);
  const tmp = `${absPath}.part`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, absPath);
  return { absPath, storedPath: toStoredPath(absPath) };
}

export function completeImage(
  id: string,
  r: { bytes: Uint8Array; mediaType: ImageMediaType; width: number | null; height: number | null; costUsd: number | null; model: string },
): GeneratedImage {
  const { storedPath } = writeImageFile(id, r.bytes, r.mediaType);
  db()
    .prepare(
      `UPDATE generated_images
          SET status = 'completed', error = NULL, file_path = ?, width = ?, height = ?, cost_usd = ?, model = ?, finished_at = ?
        WHERE id = ?`,
    )
    .run(storedPath, r.width, r.height, r.costUsd, r.model, now(), id);
  return getImage(id)!;
}

export function failImage(id: string, error: string): GeneratedImage | null {
  db()
    .prepare(`UPDATE generated_images SET status = 'failed', error = ?, finished_at = ? WHERE id = ? AND status = 'generating'`)
    .run(error.slice(0, 2000), now(), id);
  return getImage(id);
}

export function setImageSimilarity(id: string, value: unknown): void {
  db().prepare(`UPDATE generated_images SET similarity_json = ? WHERE id = ?`).run(JSON.stringify(value), id);
}
