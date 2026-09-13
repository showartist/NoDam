import { NextResponse } from "next/server";
import { z } from "zod";
import { SLOT_KEYS } from "@/lib/alignment/schema";
import { ImageGenError, httpStatusFor } from "@/lib/images/errors";
import { generateForIssue } from "@/lib/images/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  meetingId: z.string().min(1),
  issueId: z.string().min(1),
  runId: z.string().min(1).nullish(),
  positionIndex: z.number().int().min(0).optional(),
  consensus: z
    .array(
      z.object({
        slot: z.enum(SLOT_KEYS),
        value: z.string(),
        speakerKey: z.string().nullish(),
        evidence: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  resolution: z.enum(["draft", "final"]).optional(),
  referenceIds: z.array(z.string()).optional(),
});

/**
 * POST — 안건의 한 입장(positionIndex) 또는 사람이 고른 합의안(consensus)을 실제로 생성한다.
 * 실패는 실패로 돌려준다. 행을 만든 뒤 실패했으면 imageId 에 그 failed 행이 있다.
 */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "failed", code: "INVALID_INPUT", error: "요청 형식이 맞지 않습니다.", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const b = parsed.data;
  try {
    const out = await generateForIssue({
      meetingId: b.meetingId,
      issueId: b.issueId,
      runId: b.runId ?? null,
      positionIndex: b.positionIndex,
      consensus: b.consensus?.map((c) => ({ slot: c.slot, value: c.value, speakerKey: c.speakerKey ?? null, evidence: c.evidence })),
      resolution: b.resolution,
      referenceIds: b.referenceIds,
    });
    return NextResponse.json(
      {
        status: "completed",
        image: out.image,
        prompt: out.prompt,
        negative: out.negative,
        warnings: out.warnings,
        references: out.references,
        gloss: out.gloss,
        sent: out.sent,
        latencyMs: out.latencyMs,
        attempts: out.attempts,
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ImageGenError) {
      return NextResponse.json(
        { status: "failed", code: e.code, error: e.message, imageId: e.imageId, detail: e.detail },
        { status: httpStatusFor(e.code) },
      );
    }
    return NextResponse.json(
      { status: "failed", code: "PROVIDER_ERROR", error: (e as Error).message, imageId: null },
      { status: 500 },
    );
  }
}
