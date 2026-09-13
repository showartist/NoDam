/**
 * 합의 이미지를 Shot Board 쇼트에 붙인다(계획서 3-2).
 *
 * 규칙
 *   - 같은 회의에서 실제로 생성된(completed) 이미지만 붙인다. 다른 장면·다른 회의 이미지를 빌려오지 않는다.
 *   - 이미지가 바뀐 쇼트는 다시 승인 대기(proposed)가 된다. 승인은 기존 규칙대로 사람이 한다.
 *   - 붙인 기록은 versions 에 남긴다.
 */
import { db, now, recordVersion } from "../db";

export class ShotLinkError extends Error {
  constructor(readonly code: "SHOT_NOT_FOUND" | "IMAGE_NOT_FOUND" | "IMAGE_NOT_READY" | "CROSS_MEETING", message: string) {
    super(message);
    this.name = "ShotLinkError";
  }
}

export function attachImageToShot(shotId: string, imageId: string, actor: string): { shotId: string; imageUrl: string } {
  const d = db();
  const shot = d.prepare(`SELECT id, meeting_id, shot_number, image_url FROM shots WHERE id = ?`).get(shotId) as
    | { id: string; meeting_id: string; shot_number: number; image_url: string | null }
    | undefined;
  if (!shot) throw new ShotLinkError("SHOT_NOT_FOUND", "쇼트를 찾을 수 없습니다.");
  const img = d.prepare(`SELECT id, meeting_id, status, kind, model, issue_id FROM generated_images WHERE id = ?`).get(imageId) as
    | { id: string; meeting_id: string; status: string; kind: string; model: string; issue_id: string | null }
    | undefined;
  if (!img) throw new ShotLinkError("IMAGE_NOT_FOUND", "이미지를 찾을 수 없습니다.");
  if (img.status !== "completed") throw new ShotLinkError("IMAGE_NOT_READY", "생성이 끝난 이미지만 붙일 수 있습니다.");
  if (img.meeting_id !== shot.meeting_id) throw new ShotLinkError("CROSS_MEETING", "다른 회의의 이미지는 붙이지 않습니다.");
  const imageUrl = `/api/images/${img.id}`;
  d.prepare(
    `UPDATE shots SET image_url = ?, image_state = 'generated', status = 'proposed', approved_by = NULL, approved_at = NULL, updated_at = ? WHERE id = ?`,
  ).run(imageUrl, now(), shotId);
  recordVersion(shot.meeting_id, "shot_image", shotId, { imageId: img.id, model: img.model, issueId: img.issue_id, kind: img.kind, previous: shot.image_url, by: actor });
  return { shotId, imageUrl };
}
