import React from "react";
import { notFound } from "next/navigation";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { loadIssuePageData } from "@/lib/alignment/issuePage";
import { CompareBoardV2 } from "../../v2/CompareBoardV2";
import { IssueNotFound } from "../IssueNotFound";
import s from "../../v2/v2.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 3단계 "관점 비교". 안건 번호로 현재 분석의 안건을 찾는다.
 * 이전에는 안건 번호에 따라 코드에 적힌 SCENE 34 안건을 보여 줬다.
 */
export default async function ComparePage({ params }: { params: Promise<{ id: string; issueId: string }> }) {
  const { id, issueId } = await params;
  const data = loadIssuePageData(id, decodeURIComponent(issueId));
  if (data === "no_meeting") notFound();
  if (data === "no_issue") return <IssueNotFound meetingId={id} issueId={decodeURIComponent(issueId)} />;

  return (
    <main className={s.page}>
      <HeaderNavStepper
        projectId={data.projectId}
        meetingId={id}
        issueId={data.issue.issue_id}
        currentStep="compare"
        sceneNumber={data.scene.sceneNumber ?? undefined}
        slugline={data.scene.slugline ?? undefined}
        oneLiner={data.scene.oneLiner ?? undefined}
      />
      <div className={s.wrap}>
        <CompareBoardV2 meetingId={id} runId={data.runId} issue={data.issue} utts={data.utts} initialDraft={data.draft} images={data.images} />
      </div>
    </main>
  );
}
