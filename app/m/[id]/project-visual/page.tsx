import { notFound } from "next/navigation";
import { getBundle } from "@/lib/store";
import { DEMO_MEETING_ID, SCENE12_MEETING_ID, ensureScene12Seed, ensureSeed } from "@/lib/seed";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { DemoSessionDisclaimer } from "@/app/components/DemoSessionDisclaimer";
import ProjectVisualWorkspace from "./ProjectVisualWorkspace";
import { parseSceneLine } from "@/lib/alignment/present";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ProjectVisualPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (id === DEMO_MEETING_ID) {
    try {
      ensureSeed(id);
    } catch (e) {
      console.error("[seed] 데모 회의 시드 실패:", e);
    }
  } else if (id === SCENE12_MEETING_ID) {
    try {
      ensureScene12Seed(id);
    } catch (e) {
      console.error("[seed] SCENE 34 시드 실패:", e);
    }
  }

  const bundle = getBundle(id);
  if (!bundle) notFound();
  const scene = parseSceneLine(bundle.project.one_line);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#F7F7F5",
        color: "#171A1F",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <DemoSessionDisclaimer message="작품의 초기 기획 의도와 3대 역할 관점을 대조하는 통합 프로젝트 바이블 공간입니다." />
      <HeaderNavStepper
        projectId={bundle.project.id}
        meetingId={bundle.meeting.id}
        sceneNumber={scene.sceneNumber ?? undefined}
        slugline={scene.slugline ?? undefined}
        oneLiner={scene.oneLiner ?? undefined}
        currentStep={"transcript"}
      />
      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "24px" }}>
        <ProjectVisualWorkspace projectId={bundle.project.id} />
      </main>
    </div>
  );
}
