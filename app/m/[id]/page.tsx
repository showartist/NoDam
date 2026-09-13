import { notFound } from "next/navigation";
import { getBundle } from "@/lib/store";
import { activeProvider } from "@/lib/extract";
import { DEMO_MEETING_ID, SCENE12_MEETING_ID, ensureScene12Seed, ensureSeed } from "@/lib/seed";
import Workbench from "./Workbench";
import { getCurrentRun, listIssues } from "@/lib/alignment/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABS = ["transcript", "brief", "issues", "shotboard", "previs", "project_visual_workspace"] as const;

/**
 * 한 회의 = 하나의 완성된 데이터 출처.
 *
 * 이전에는 DB bundle 과 fixture fallback 을 필드 단위로 `?? ` 병합했다.
 * 그 결과 한 장면의 전사와 다른 장면의 Scene Brief 가 같은 화면에 나왔다.
 * (m_01 = SCENE 34 실내 수영장 · 발표 시연 / m_02 = SCENE 12 모텔방 · 비교용)
 *
 * 규칙
 *   bundle 있음  → bundle 만 사용한다
 *   bundle 없음  → notFound. 다른 장면 데이터로 채우지 않는다
 *   일부 필드 빔 → 그 필드의 빈 상태로 표시한다 (다른 장면에서 빌려오지 않는다)
 */
export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const initialTab = TABS.find((t) => t === tab);

  // 정해진 데모 id 만 자동 시드한다. 임의의 id 를 특정 장면으로 시드하면 회의가 복제된다.
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
  const run = getCurrentRun(id, { includeRunning: true });
  const alignmentV2 = run ? { runId: run.id, model: run.model, createdAt: run.created_at, issues: listIssues(id, run.id) } : null;

  return (
    <Workbench
      meetingId={bundle.meeting.id}
      project={bundle.project}
      provider={activeProvider()}
      utterances={bundle.utterances}
      briefItems={bundle.briefItems}
      decisions={bundle.decisions}
      unresolved={bundle.unresolved}
      shots={bundle.shots}
      references={bundle.references}
      sceneIssues={bundle.sceneIssues}
      alignmentResolution={bundle.alignmentResolution ?? null}
      alignmentScoreSnapshot={bundle.alignmentScoreSnapshot ?? null}
      intentCoverage={bundle.intentCoverage}
      alignmentV2={alignmentV2}
      initialTab={initialTab}
    />
  );
}
