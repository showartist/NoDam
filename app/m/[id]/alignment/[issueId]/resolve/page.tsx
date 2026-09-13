import React from "react";
import { notFound } from "next/navigation";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { loadIssuePageData } from "@/lib/alignment/issuePage";
import { ResolveBoardV2 } from "../../v2/ResolveBoardV2";
import { IssueNotFound } from "../IssueNotFound";
import s from "../../v2/v2.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 4단계 "합의". 사람이 이름을 적고 승인해야 안건이 해결된다. */
export default async function ResolvePage({ params }: { params: Promise<{ id: string; issueId: string }> }) {
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
        currentStep="resolve"
        sceneNumber={data.scene.sceneNumber ?? undefined}
        slugline={data.scene.slugline ?? undefined}
        oneLiner={data.scene.oneLiner ?? undefined}
      />
      <div className={s.wrap}>
        <ResolveBoardV2
          meetingId={id}
          runId={data.runId}
          issue={data.issue}
          utts={data.utts}
          draft={data.draft}
          resolution={data.resolution}
          images={data.images}
          shots={data.shots}
        />
      </div>
    </main>
  );
}
