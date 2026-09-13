import { NextResponse } from "next/server";
import { MAX_IMAGES_PER_DECISION, MAX_IMAGES_PER_MEETING } from "@/lib/domain/imageGeneration/types";
import { listImages, quotaOverridden } from "@/lib/images/storage";

export const runtime = "nodejs";

/** GET — 회의의 생성 이미지 목록(실패 포함). ?issueId= 로 안건 하나만. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id: meetingId } = await props.params;
  const issueId = new URL(req.url).searchParams.get("issueId");
  const images = listImages(meetingId, { issueId });
  const meetingUsed = (issueId ? listImages(meetingId) : images).filter(
    (i) => i.status === "completed" || i.status === "generating",
  ).length;
  return NextResponse.json({
    images,
    quota: {
      perDecision: MAX_IMAGES_PER_DECISION,
      perMeeting: MAX_IMAGES_PER_MEETING,
      meetingUsed,
      overridden: quotaOverridden(),
    },
  });
}
