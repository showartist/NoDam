import IntakeNotice from "@/app/components/IntakeNotice";
import React from "react";
import { notFound } from "next/navigation";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { loadAlignmentPageData } from "@/lib/alignment/pageData";
import { ReviewBoardV2 } from "./v2/ReviewBoardV2";
import s from "./v2/v2.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2단계 "다시 짚기". 이 회의의 해석 차이 분석(v2) 결과를 읽는다.
 * 이전에는 SCENE 34 발언 6줄을 코드에 적어 두고 낱말 규칙을 돌렸다. 이제 회의 데이터만 쓴다.
 */
export default async function AlignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = loadAlignmentPageData(id);
  if (!data) notFound();

  return (
    <main className={s.page}>
      <HeaderNavStepper
        projectId={data.projectId}
        meetingId={id}
        issueId={data.issues[0]?.issue_id}
        currentStep="review"
        sceneNumber={data.scene.sceneNumber ?? undefined}
        slugline={data.scene.slugline ?? undefined}
        oneLiner={data.scene.oneLiner ?? undefined}
      />
      <IntakeNotice meetingId={id} />
      <div className={s.wrap}>
        <ReviewBoardV2
          meetingId={id}
          run={data.run}
          lastFailed={data.lastFailed}
          issues={data.issues}
          agreements={data.agreements}
          utts={data.utts}
          utteranceCount={data.utteranceCount}
        />
      </div>
    </main>
  );
}
