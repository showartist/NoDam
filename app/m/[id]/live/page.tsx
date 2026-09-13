import React from "react";
import { notFound } from "next/navigation";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { loadAlignmentPageData } from "@/lib/alignment/pageData";
import { listReplaySources } from "@/lib/live/sources";
import { LiveBoard } from "./LiveBoard";
import s from "../alignment/v2/v2.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 회의 중 화면: 마이크 조각 녹음 또는 녹음 파일 재생 → 전사 → 창 단위 안건 갱신. */
export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = loadAlignmentPageData(id);
  if (!data) notFound();
  return (
    <main className={s.page}>
      <HeaderNavStepper
        projectId={data.projectId}
        meetingId={id}
        currentStep="transcript"
        sceneNumber={data.scene.sceneNumber ?? undefined}
        slugline={data.scene.slugline ?? undefined}
        oneLiner={data.scene.oneLiner ?? undefined}
      />
      <div className={s.wrap}>
        <LiveBoard meetingId={id} hasUtterances={data.utteranceCount > 0} sources={listReplaySources().map((x) => x.name)} />
      </div>
    </main>
  );
}
