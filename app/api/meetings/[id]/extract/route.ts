import { NextResponse } from "next/server";
import { getBundle, saveExtraction } from "@/lib/store";
import { runExtraction } from "@/lib/extract";
import { getMeetingUtterances } from "@/lib/alignment/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const bundle = getBundle(id);
  if (!bundle) return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });

  // 녹음에서 온 발언은 speaker_name 이 비어 있다. 사람이 붙인 화자 매핑(이름·역할)을 먼저 쓴다.
  const mapped = new Map(getMeetingUtterances(id).map((u) => [u.uid, u]));
  const run = await runExtraction(
    { title: bundle.project.title, domain: bundle.project.domain, one_line: bundle.project.one_line },
    bundle.utterances.map((u) => ({
      uid: u.uid,
      speakerName: mapped.get(u.uid)?.speakerName ?? u.speaker_name ?? u.speaker_id ?? "화자 미상",
      role: mapped.get(u.uid)?.role ?? u.role,
      tsStart: u.ts_start,
      tsEnd: u.ts_end,
      textRaw: u.text_raw,
      textClean: u.text_clean,
      stageDirection: u.stage_direction,
    })),
  );

  if (!run.ok) {
    return NextResponse.json(
      { error: run.message, provider: run.provider, attempts: run.attempts },
      { status: 422 },
    );
  }

  saveExtraction(id, run.value);
  return NextResponse.json({ ok: true, provider: run.provider, attempts: run.attempts });
}
