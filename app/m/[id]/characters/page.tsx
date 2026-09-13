import React from "react";
import { notFound } from "next/navigation";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { loadAlignmentPageData } from "@/lib/alignment/pageData";
import { CharacterBoard } from "./CharacterBoard";
import s from "../alignment/v2/v2.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 캐릭터 컨셉 초안: 작품의 회의에서 모은 인물 묘사로 초안을 그리고, 묘사가 바뀌면 이전 판을 참조로 같은 사람을 이어 그린다.
 */
export default async function CharactersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = loadAlignmentPageData(id);
  if (!data) notFound();
  return (
    <main className={s.page}>
      <HeaderNavStepper
        projectId={data.projectId}
        meetingId={id}
        currentStep="production"
        sceneNumber={data.scene.sceneNumber ?? undefined}
        slugline={data.scene.slugline ?? undefined}
        oneLiner={data.scene.oneLiner ?? undefined}
      />
      <div className={s.wrap}>
        <CharacterBoard meetingId={id} projectTitle={data.projectTitle} />
      </div>
    </main>
  );
}
