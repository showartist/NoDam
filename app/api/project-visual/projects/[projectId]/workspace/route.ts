import { getProjectVisualService } from "@/lib/services/projectVisual";
import { handle } from "../../../http";
import type { ProjectVisualWorkspaceModel } from "@/app/m/[id]/project-visual/types";

export async function GET(_: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (projectId === "project-1") {
    return handle(async () => getProjectVisualService().getProjectVisualWorkspace(projectId));
  }
  return handle(async () => {
    try {
      const model = await getProjectVisualService().getProjectVisualWorkspace(projectId);
      if (!model || (!model.references.length && !model.principles.length && !model.characterVisuals.length)) {
        return getDemoWorkspaceFallback(projectId);
      }
      return model;
    } catch {
      return getDemoWorkspaceFallback(projectId);
    }
  });
}

function getDemoWorkspaceFallback(projectId: string): ProjectVisualWorkspaceModel {
  const nowStr = new Date().toISOString();
  return {
    project: {
      id: projectId,
      title: "숨 (Breath)",
      domain: "영화 (Feature Film)",
      status: "development",
      oneLine: "실종된 동생의 흔적을 쫓던 수현은 폐쇄된 실내 수영장에서 결정적 증거를 발견한다.",
    },
    participants: [
      { id: "dir_01", projectId, name: "한지우 (감독)", role: "director", createdAt: nowStr },
      { id: "dop_01", projectId, name: "이강 (촬영감독)", role: "cinematographer", createdAt: nowStr },
      { id: "art_01", projectId, name: "정서윤 (미술감독)", role: "art_director", createdAt: nowStr },
      { id: "prod_01", projectId, name: "최제작 (제작PD)", role: "producer", createdAt: nowStr },
    ],
    scenes: [
      { id: "s_34", sceneNumber: 34, title: "INT. 실내 수영장 · NIGHT", reviewStatus: "review_required" },
      { id: "s_12", sceneNumber: 12, title: "EXT. 폐허 병원 입구 · DAY", reviewStatus: "current" },
    ],
    shots: [
      { id: "shot_1", sceneId: "s_34", shotNumber: 1, title: "수영장 와이드 마스터 샷", status: "approved", generatedImageState: "generated", imageUri: "/images/pool_director.png" },
      { id: "shot_2", sceneId: "s_34", shotNumber: 2, title: "수현 먼 거리 인물 구도", status: "approved", generatedImageState: "generated", imageUri: "/images/pool_cinematographer.png" },
      { id: "shot_3", sceneId: "s_34", shotNumber: 3, title: "청록빛 타일 반사 인접 샷", status: "approved", generatedImageState: "generated", imageUri: "/images/pool_art_director.png" },
    ],
    references: [
      {
        id: "ref_1",
        title: "감독안: 인물 없는 텅 빈 수영장",
        sourceMethod: "AI 시각 해석 엔진",
        contentType: "cinematic_still",
        adoptionLevel: "core",
        referenceImageState: "uploaded",
        assetUri: "/images/pool_director.png",
        take: ["차가운 틸(Teal) 조명 톤", "공허하고 묵직한 수영장 공간감", "피사체 부재의 고요한 긴장감"],
        drop: ["접영이나 수영하는 인물", "폐허 느낌의 손상된 구조물"],
        responsibleRole: "director",
        evidence: [{ uid: "U-03", speaker: "감독" }],
        versionLabel: "v1.0",
        sceneIds: ["s_34"],
      },
      {
        id: "ref_2",
        title: "촬영감독안: 멀리 작은 인물이 있는 와이드",
        sourceMethod: "AI 시각 해석 엔진",
        contentType: "cinematic_still",
        adoptionLevel: "support",
        referenceImageState: "uploaded",
        assetUri: "/images/pool_cinematographer.png",
        take: ["화면 가장자리 작은 인물의 스케일 기준점", "깊고 입체적인 피사계 심도", "그림자와 반사 조명의 대비"],
        drop: ["중심 인물 포지션", "밝은 드라마 조명"],
        responsibleRole: "cinematographer",
        evidence: [{ uid: "U-04", speaker: "촬영감독" }],
        versionLabel: "v1.0",
        sceneIds: ["s_34"],
      },
      {
        id: "ref_3",
        title: "미술감독안: 청록빛 젖은 타일 반사 중심",
        sourceMethod: "AI 시각 해석 엔진",
        contentType: "texture_study",
        adoptionLevel: "support",
        referenceImageState: "uploaded",
        assetUri: "/images/pool_art_director.png",
        take: ["에메랄드/청록빛 타일 물결 반사", "레인 번호 및 실내 수영장 실질 구조", "매끄럽고 정결한 세라믹 타일 질감"],
        drop: ["욕실이나 목욕탕 타일 느낌", "인물의 등장"],
        responsibleRole: "art_director",
        evidence: [{ uid: "U-05", speaker: "미술감독" }],
        versionLabel: "v1.0",
        sceneIds: ["s_34"],
      },
    ],
    principles: [
      {
        id: "pr_1",
        title: "VP-01: 실내 수영장 비주얼 톤앤매너 확정안",
        status: "confirmed",
        currentVersionId: "pv_1",
        currentVersion: {
          id: "pv_1",
          principleId: "pr_1",
          versionNumber: 1,
          principleText: "수현의 고립감을 극대화하기 위해 인물을 강조하지 않는 와이드 수영장 샷과 청록빛 틸 톤 타일 반사 조명을 채택한다.",
          rationale: "직군 간 동상이몽(감독·촬영·미술)을 AI로 분석하여 도출한 합의된 톤앤매너.",
          changeSummary: "초기 3자 대립 안건에서 AI 조율을 통해 확정.",
          evidence: [{ uid: "U-03" }, { uid: "U-04" }, { uid: "U-05" }],
          sourceQuestionId: "dq_1",
          createdBy: "dir_01",
          createdAt: nowStr,
        },
        approvals: [
          { id: "ap_1", principleVersionId: "pv_1", approverId: "dir_01", role: "director", status: "active", evidenceUid: "U-03", approvedAt: nowStr, withdrawnAt: null },
          { id: "ap_2", principleVersionId: "pv_1", approverId: "prod_01", role: "producer", status: "active", evidenceUid: "U-05", approvedAt: nowStr, withdrawnAt: null },
        ],
        sceneIds: ["s_34"],
        shotIds: ["shot_1", "shot_2", "shot_3"],
      },
    ],
    decisionQuestions: [
      {
        id: "dq_1",
        question: "SCENE 34 수영장 씬에서 수현(인물)을 프레임 안으로 배치할 것인가, 텅 빈 공간만 묘사할 것인가?",
        context: "감독은 완벽히 빈 공간을 원하고, 촬영감독은 스케일감을 위해 먼 배경에 작은 인물 배치를 제안함.",
        state: "decided",
        priority: 1,
        decidedOption: "메인 와이드에서는 인물을 제외하되, 카메라 무빙 후반이나 익스트림 롱샷에서만 가장자리에 아주 작게 배치한다.",
        decidedBy: "dir_01",
        decidedAt: nowStr,
        evidence: [{ uid: "U-03" }, { uid: "U-04" }],
      },
    ],
    characterVisuals: [
      {
        id: "cv_1",
        characterId: "c_01",
        characterName: "수현 (Protagonist)",
        versionNumber: 1,
        status: "confirmed",
        faceAssetUri: "/images/vref_r01.png",
        costumeAssetUri: "/images/vref_r02.png",
        fullbodyAssetUri: "/images/pool_cinematographer.png",
        inspaceAssetUri: "/images/pool_cinematographer.png",
        propAssetUri: "/images/pool_art_director.png",
        continuityLock: { tone: "저채도 틸 톤, 서늘하고 묵직한 무드" },
        allowed: ["어두운 색상의 트렌치 코트 및 수영모", "냉정하고 차분한 무표정"],
        prohibited: ["밝고 화사한 의상", "과도하게 감정적인 제스처"],
        evidence: [{ uid: "U-01" }, { uid: "U-02" }],
        approvedBy: "dir_01",
        approvedAt: nowStr,
        sceneIds: ["s_34"],
      },
    ],
    cascadeImpacts: [
      {
        id: "ci_1",
        principleVersionId: "pv_1",
        changeType: "first_confirmation",
        targetType: "scene",
        targetId: "s_34",
        impactResult: "affected",
        targetNewStatus: "review_required",
        reason: "VP-01 수영장 비주얼 원칙이 확정됨에 따라 SCENE 34 콘티 보드 전체에 청록빛 조명 및 구도 가이드 라인이 전파됨.",
        evaluatedAt: nowStr,
        appliedAt: nowStr,
      },
    ],
    decisionLineage: [
      {
        id: "dl_1",
        sourceType: "question",
        sourceId: "dq_1",
        relation: "resolved_by",
        targetType: "principle",
        targetId: "pr_1",
        evidenceUid: "U-03",
        createdAt: nowStr,
      },
    ],
  };
}
