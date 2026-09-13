"use client";

import { useMemo, useState } from "react";
import { calculateSceneSyncScore } from "@/lib/score";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { parseSceneLine } from "@/lib/alignment/present";
import { DemoSessionDisclaimer } from "@/app/components/DemoSessionDisclaimer";
import ProjectVisualWorkspace from "./project-visual/ProjectVisualWorkspace";
import { getRecommendedInitialTab } from "@/lib/tab_recommendation";
import { filterUtterancesByRole, searchUtterancesByKeyword, getEvidenceIndex, TYPOGRAPHY_THEME, filterUtterancesBySemantic, getUidLinkageNode, formatCompactHeader, type SemanticFilterType } from "@/lib/transcript_filters";
import { evaluateShotApproval, getProductionBlockers } from "@/lib/shot_approval";
import { evaluateCharacterFieldState, getProjectIssueImpact, classifyBriefState } from "@/lib/project_dev_view";
import {
  CONFIDENCE_LABEL,
  DETECTION_SIGNAL_LABEL,
  type DetectionSignal,
  IMAGE_STATE_LABEL,
  IMPACT_ACTION_LABEL,
  IMPACT_STATUS_LABEL,
  REFERENCE_APPLICATIONS,
  REFERENCE_APPLICATION_LABEL,
  REFERENCE_KIND_LABEL,
  ROLES,
  ROLE_BRIEF_FIELDS,
  ROLE_FOCUS_NOTE,
  ROLE_LABEL,
  SCENE_BRIEF_FIELDS,
  SCENE_BRIEF_LABEL,
  SCENE_ISSUE_ACTION,
  SCENE_ISSUE_LABEL,
  COVERAGE_ACTION_LABEL,
  COVERAGE_ACTIONS,
  COVERAGE_ROLE_LABEL,
  COVERAGE_STATE_LABEL,
  COVERAGE_STATUS_LABEL,
  INTENT_LABEL,
  ISSUE_SUBJECT_SHOT_COVERAGE,
  REPRESENTATIVE_SHOT_COUNT,
  SHOT_COUNT_RECOMMENDED_MAX,
  SHOT_PROPOSAL_FIELDS,
  SHOT_STATUS_LABEL,
  SLUGLINE_FIELDS,
  STATE_LABEL,
  type Confidence,
  type DecisionState,
  type ReferenceApplication,
  type ReferenceKind,
  type Role,
  type SceneBriefField,
  type SceneIssueType,
  type CoverageActionKey,
  type CoverageVerificationState,
  type ImageState,
  type IntentType,
  type ShotStatus,
} from "@/lib/types";
import type {
  AlignmentResolutionRow,
  AlignmentScoreSnapshotRow,
  BriefItemRow,
  ProjectRow,
  ReferenceRow,
  SceneIssueRow,
  ShotRow,
  UnresolvedRow,
  UtteranceRow,
} from "@/lib/store";
import type { IntentCoverageReport } from "@/lib/coverage";
import type { IntentCoverageViewModel } from "@/lib/intents";

import { OnSetCommandCenter, type OnSetAlignment } from "./OnSetCommandCenter";

type Mode = "project_dev" | "scene_dev";
type Tab =
  | "project_visual_workspace"
  | "project_core"
  | "character_bible"
  | "visual_alignment"
  | "dev_issues"
  | "on_set_command_center"
  | "transcript"
  | "brief"
  | "issues"
  | "shotboard"
  | "previs";

const PROJECT_TABS: Tab[] = ["project_visual_workspace"];

/**
 * 탭 바에 실제로 그려지는 장면 탭.
 *
 * 상단 5단계 스테퍼(회의 기록 → 다시 짚기 → 관점 비교 → 합의 → 최종 제작안)가 주 동선이다.
 * 그 5개와 같은 화면을 여는 탭은 여기 두지 않는다. 같은 곳으로 가는 길이 두 개면 어느 쪽이
 * 본 동선인지 알 수 없고, 화면 위에 네비게이션이 두 층으로 겹쳐 보인다.
 *
 * 여기 남는 것은 스테퍼에 없는 보조 화면뿐이다.
 * transcript·shotboard 는 스테퍼가 `?tab=` 으로 직접 여는 대상이라 렌더 분기는 유지하되
 * 중복 버튼만 걷어냈다.
 */
const SCENE_TABS: Tab[] = ["on_set_command_center", "brief", "issues", "previs"];

// 통일된 한글 탭 라벨
const TAB_LABEL: Record<Tab, string> = {
  project_visual_workspace: "Visual Workspace",
  project_core: "작품 핵심",
  character_bible: "캐릭터",
  visual_alignment: "시각 정렬",
  dev_issues: "개발 이슈",
  on_set_command_center: "🎬 현장 지휘 센터",
  shotboard: "쇼트보드",
  brief: "장면 명세",
  issues: "장면 이슈",
  transcript: "회의 전사",
  previs: "프리비즈",
};

const ROLE_BADGE_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  director: { bg: "#172554", color: "#93c5fd", border: "#1d4ed8", label: "DIR · 감독" },
  writer: { bg: "#3b0764", color: "#f5d0fe", border: "#6b21a8", label: "WRI · 작가" },
  producer: { bg: "#052e16", color: "#86efac", border: "#15803d", label: "PROD · 제작" },
  cinematographer: { bg: "#042f2e", color: "#99f6e4", border: "#0f766e", label: "DOP · 촬영" },
  art_director: { bg: "#451a03", color: "#fef08a", border: "#b45309", label: "ART · 미술" },
  "감독": { bg: "#172554", color: "#93c5fd", border: "#1d4ed8", label: "DIR · 감독" },
  "작가": { bg: "#3b0764", color: "#f5d0fe", border: "#6b21a8", label: "WRI · 작가" },
  "제작PD": { bg: "#052e16", color: "#86efac", border: "#15803d", label: "PROD · 제작" },
  "촬영감독": { bg: "#042f2e", color: "#99f6e4", border: "#0f766e", label: "DOP · 촬영" },
  "미술감독": { bg: "#451a03", color: "#fef08a", border: "#b45309", label: "ART · 미술" },
};

const parseJson = <T,>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export default function Workbench(props: {
  meetingId: string;
  project: ProjectRow;
  provider: "openrouter" | "claude" | "fixture";
  utterances: UtteranceRow[];
  briefItems: BriefItemRow[];
  decisions: (BriefItemRow & { did: string })[];
  unresolved: UnresolvedRow[];
  shots: ShotRow[];
  references: ReferenceRow[];
  sceneIssues: SceneIssueRow[];
  alignmentResolution?: AlignmentResolutionRow | null;
  alignmentScoreSnapshot?: AlignmentScoreSnapshotRow | null;
  // 단일 필수 소스 — reports/gaps/productionImpacts/loadError 를 각각 optional prop 으로
  // 쪼개지 않는다. 실제로 그렇게 쪼갰던 coverageReports?/coverageGaps? 는 page.tsx 가 채워준 적이
  // 없어 항상 undefined 였고(장면 정렬도 점수가 실제 커버리지 gap 을 절대 반영하지 못했다), 이제
  // 전부 이 하나의 값에서 파생한다.
  intentCoverage: IntentCoverageViewModel;
  /** 현재 해석 차이 분석(v2). 돌린 적이 없으면 null */
  alignmentV2?: OnSetAlignment | null;
  initialTab?: Tab;
}) {
  const defaultTab = useMemo(() => {
    if (props.initialTab) return props.initialTab;
    return getRecommendedInitialTab(props.shots, props.briefItems, props.unresolved) as Tab;
  }, [props.initialTab, props.shots, props.briefItems, props.unresolved]);

  const [mode, setMode] = useState<Mode>("scene_dev");
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [role, setRole] = useState<Role>("all");
  const [semanticFilter, setSemanticFilter] = useState<SemanticFilterType>("all");
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [activeEvidenceList, setActiveEvidenceList] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCharacter, setSelectedCharacter] = useState<string>("수현");
  const [hoveredUidNode, setHoveredUidNode] = useState<{ uid: string; issues: string[]; shots: number[] } | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [approvingShotId, setApprovingShotId] = useState<string | null>(null);
  const [verifyingLinkId, setVerifyingLinkId] = useState<string | null>(null);

  /**
   * 감독 확인 — AI 가 proposed 로 제안한 커버리지 주장을 approved 로 바꾸는 유일한 경로
   * (/api/coverage/verify, lib/intents.ts 의 verifyCoverage). AI 는 스스로 verified 를
   * 부여할 수 없고, approved_by/approved_at 없이는 승인 상태가 되지 않는다 — 그 규칙은
   * 서버(verifyCoverage)가 강제하고, 여기서는 그 결과를 그대로 반영한다.
   */
  async function verifyClaim(linkId: string) {
    setVerifyingLinkId(linkId);
    try {
      const res = await fetch(`/api/coverage/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId, state: "verified" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? "감독 확인에 실패했습니다.");
        return;
      }
      window.location.reload();
    } catch {
      alert("감독 확인 요청 중 오류가 발생했습니다.");
    } finally {
      setVerifyingLinkId(null);
    }
  }

  /**
   * 최종 승인. image_state 가 'generated' 가 아니면 store 가 예외를 던지고
   * API 가 400 을 돌려준다 — 여기서는 그 실패를 사용자에게 그대로 보여준다.
   * 화면 쪽에서도 버튼을 비활성화하지만, 서버 쪽 가드가 최종 방어선이다.
   */
  async function approveShot(shotId: string) {
    setApprovingShotId(shotId);
    try {
      const res = await fetch(`/api/shots/${shotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? "최종 승인에 실패했습니다.");
        return;
      }
      window.location.reload();
    } catch {
      alert("최종 승인 요청 중 오류가 발생했습니다.");
    } finally {
      setApprovingShotId(null);
    }
  }

  const slugline = useMemo(() => {
    const get = (f: SceneBriefField) => {
      const row = props.briefItems.find((b) => b.field === f);
      return (row ? row.user_value ?? row.ai_value : "").trim();
    };
    const [num, intExt, loc, time] = SLUGLINE_FIELDS.map(get);
    const head = [intExt, loc].filter(Boolean).join(" ");
    const body = [head, time].filter(Boolean).join(" – ");
    return [num, body].filter(Boolean).join(" · ");
  }, [props.briefItems]);

  const roleUnresolved = useMemo(
    () => props.unresolved.filter((u) => (role === "all" ? true : parseJson<string[]>(u.blocks_roles, []).includes(role))),
    [props.unresolved, role],
  );

  // scene_issues.evidence 는 DB 에 JSON 문자열로 저장된다 — filterUtterancesBySemantic/getUidLinkageNode
  // 는 evidence 가 이미 배열인 것을 전제하므로(원래 gold fixture 형식 기준) 여기서 한 번 파싱해 둔다.
  const parsedSceneIssues = useMemo(
    () => props.sceneIssues.map((i) => ({ ...i, evidence: parseJson<string[]>(i.evidence, []) })),
    [props.sceneIssues],
  );

  const filteredUtterances = useMemo(() => {
    let rows = filterUtterancesByRole(props.utterances, role);
    rows = filterUtterancesBySemantic(rows, semanticFilter, parsedSceneIssues, props.shots);
    if (searchQuery.trim()) {
      rows = searchUtterancesByKeyword(rows, searchQuery);
    }
    return rows;
  }, [props.utterances, role, semanticFilter, props.shots, parsedSceneIssues, searchQuery]);

  const evidenceNavInfo = useMemo(() => {
    if (!selectedUid || activeEvidenceList.length === 0) return null;
    return getEvidenceIndex(activeEvidenceList, selectedUid);
  }, [selectedUid, activeEvidenceList]);

  // 화면에 보이는 장면 정보는 전부 현재 회의 데이터에서만 나온다.
  // 하드코딩하면 다른 장면을 열어도 같은 문자열이 남아 회의 간 오염이 된다.
  /**
   * 장면 3대 앵커 — 현재 회의의 Intent 에서만 뽑는다.
   * 이전에는 SCENE34_ANCHORS 상수를 렌더해 어떤 장면을 열어도 SCENE 34 문구가 나왔다.
   * 상태 표기도 실제 커버리지 상태를 따른다. 임의로 confirmed 라고 쓰지 않는다.
   */
  const sceneAnchors = useMemo(() => {
    const pick = (t: IntentType) => {
      const r = props.intentCoverage.reports.find(
        (x: IntentCoverageReport) => x.intent.type === t,
      );
      if (!r) return null;
      const label = (COVERAGE_STATUS_LABEL as Record<string, string>)[r.status] ?? r.status;
      return { text: r.intent.text, status: label };
    };
    return { key_action: pick("key_action"), last_image: pick("last_image"), key_object: pick("key_object") };
  }, [props.intentCoverage]);

  const sceneNumber = useMemo(() => {
    const row = props.briefItems.find((b) => b.field === SLUGLINE_FIELDS[0]);
    const v = (row ? row.user_value ?? row.ai_value : "").trim();
    if (!v) return "";
    return /^\d+$/.test(v) ? `SCENE ${v}` : v;
  }, [props.briefItems]);

  const blockers = useMemo(() => getProductionBlockers(props.sceneIssues as any), [props.sceneIssues]);
  const openIssues = props.sceneIssues.filter((i) => i.status === "open");
  const approvedShots = props.shots.filter((s) => s.status === "approved").length;
  const unapprovedShotsCount = props.shots.filter((s) => s.status !== "approved").length;
  const pendingApproval = props.briefItems.filter((b) => b.verification_state !== "approved").length;

  const scoreResult = useMemo(() => {
    const gapsCount = props.intentCoverage.gaps.length;
    return calculateSceneSyncScore(props.sceneIssues as any, gapsCount, unapprovedShotsCount, pendingApproval);
  }, [props.sceneIssues, props.intentCoverage, unapprovedShotsCount, pendingApproval]);

  // 구형 Project Development 탭은 API 기반 Visual Workspace로 대체되었다.
  // 아래 빈 legacy 값은 제거 예정인 비활성 JSX의 타입 호환만 유지하며 화면에는 노출되지 않는다.
  const pb = { working_title: props.project.title, english_title: "", format: "", genre: "", one_liner: props.project.one_line ?? "", logline: "", short_synopsis: "", theme: "", dramatic_question: "", tone: "", target_audience: "", ending_direction: "" };
  const char = { name: "", story_role: "", external_goal: "", internal_need: "", wound: "", contradiction: "", fear: "", arc: "" };
  const vRefs: any[] = [];
  const vAlignIssues: any[] = [];
  const legacyProjectIssues: any[] = [];

  const toggleDetail = (id: string) => {
    setExpandedDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleUidMouseEnter = (uid: string) => {
    const node = getUidLinkageNode(uid, parsedSceneIssues, props.shots, props.briefItems);
    if (node.issues.length > 0 || node.shots.length > 0) {
      setHoveredUidNode({ uid, issues: node.issues, shots: node.shots });
    }
  };

  return (
    <div className="scenenote-app" style={{ minHeight: "100vh", background: "#f8fafc", color: TYPOGRAPHY_THEME.textPrimary, fontFamily: "'Inter', sans-serif" }}>
      {/* mode: setMode("scene_dev") */}
      <HeaderNavStepper
        projectId={props.project.id}
        meetingId={props.meetingId}
        currentStep={tab === "transcript" ? "transcript" : tab === "shotboard" || tab === "previs" ? "production" : "transcript"}
        sceneNumber={parseSceneLine(props.project.one_line).sceneNumber ?? undefined}
        slugline={parseSceneLine(props.project.one_line).slugline ?? slugline ?? undefined}
        oneLiner={parseSceneLine(props.project.one_line).oneLiner ?? undefined}
      />
      <DemoSessionDisclaimer message="임시 데모 세션으로 실행 중입니다. 작성된 데이터는 영속 DB로 처리됩니다." />

      {/* 🔴 제작 차단 긴급 배너 */}
      {blockers.length > 0 && mode === "scene_dev" && (
        <div style={{ background: "#fef2f2", borderBottom: "1px solid #fca5a5", padding: "10px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16 }}>🔴</span>
            <div>
              <strong style={{ color: "#991b1b", fontSize: 13, fontWeight: 800 }}>
                제작 차단 {blockers.length}건 — 해결 전 촬영 진행 불가
              </strong>
              <span style={{ fontSize: 12, color: "#7f1d1d", marginLeft: 12 }}>
                {blockers.map((b) => `• ${b.subject}`).join("  |  ")}
              </span>
            </div>
          </div>
          <button
            onClick={() => setTab("issues")}
            style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 4, padding: "4px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
          >
            차단 안건 해결 ▶
          </button>
        </div>
      )}

      <div className="scenenote-container" style={{ padding: "16px 24px", maxWidth: 1440, margin: "0 auto" }}>
        {/* 헤더 & 장면 3대 앵커 */}
        <header style={{ marginBottom: 16, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 900, color: TYPOGRAPHY_THEME.textPrimary, margin: 0 }}>
                {mode === "project_dev" ? `〈${props.project.title}〉 Project Visual Workspace` : (slugline || props.project.title)}
              </h1>
              <p style={{ fontSize: 12, color: TYPOGRAPHY_THEME.textSecondary, margin: "4px 0 0 0" }}>
                {props.project.one_line ?? ""}
              </p>
            </div>

            <nav style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {/* 주 동선은 상단 5단계 스테퍼다. 이 줄은 그 밖의 보조 화면이라는 걸 라벨로 밝힌다. */}
              {mode === "scene_dev" && (
                <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 700, marginRight: 4 }}>참고 화면</span>
              )}
              {(mode === "project_dev" ? PROJECT_TABS : SCENE_TABS).map((t) => (
                <button
                  className="scenenote-workbench-tab"
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: tab === t ? "#2563eb" : "#ffffff",
                    color: tab === t ? "#ffffff" : "#475569",
                    border: tab === t ? "1px solid #2563eb" : "1px solid #cbd5e1",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: tab === t ? 800 : 600,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </nav>
          </div>

          {/* Intent Coverage 조회 실패 */}
          {mode === "scene_dev" && props.intentCoverage.loadError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 14px", color: "#991b1b", fontSize: 12 }}>
              ⚠️ Intent Coverage 를 불러오지 못했습니다: {props.intentCoverage.loadError}
            </div>
          )}

          {/* 장면 3대 앵커 바 (화이트 미니멀) */}
          {mode === "scene_dev" && !props.intentCoverage.loadError && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, background: "#ffffff", padding: "10px 16px", borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              {(
                [
                  ["key_action", "🎯 핵심 행동", "#2563eb"],
                  ["last_image", "🎬 마지막 이미지", "#d97706"],
                  ["key_object", "📦 핵심 오브제", "#059669"],
                ] as const
              ).map(([key, label, color]) => {
                const a = sceneAnchors[key];
                return (
                  <div key={key} style={{ fontSize: 12 }} data-testid={`scene-anchor-${key}`}>
                    <span style={{ color, fontWeight: 800 }}>
                      {label} {a ? `(${a.status})` : ""}:{" "}
                    </span>
                    <span style={{ color: a ? "#0f172a" : "#64748b" }}>
                      {a ? a.text : "이 장면에 등록된 의도가 없습니다"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </header>

        {/* ========================================================================= */}
        {/* MODE 1: PROJECT DEVELOPMENT (작품 개발 모드 고도화) */}
        {/* ========================================================================= */}
        {mode === "project_dev" && (
          <div>
            {tab === "project_visual_workspace" && (
              <ProjectVisualWorkspace projectId={props.project.id} />
            )}

            {/* 1. 작품 핵심 (Project Core) 탭 */}
            {tab === "project_core" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    <h3 style={{ fontSize: 16, color: "#2563eb", fontWeight: 800, margin: 0 }}>📖 Project Bible 12필드</h3>
                    <span style={{ fontSize: 11, color: "#059669", background: "#ecfdf5", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>
                      확정 · 작가 최은서 승인 (U12)
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
                    <div><strong style={{ color: "#64748b" }}>가제 (Working Title):</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.working_title} ({pb.english_title})</span></div>
                    <div><strong style={{ color: "#64748b" }}>형식 & 장르:</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.format} · {pb.genre}</span></div>
                    <div><strong style={{ color: "#64748b" }}>한 줄 소개 (One-liner):</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.one_liner}</span></div>
                    <div><strong style={{ color: "#64748b" }}>로그라인 (Logline):</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.logline}</span></div>
                    <div><strong style={{ color: "#64748b" }}>짧은 시놉시스:</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary, lineHeight: 1.5 }}>{pb.short_synopsis}</span></div>
                  </div>
                </div>

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
                    <h3 style={{ fontSize: 16, color: "#16a34a", fontWeight: 800, margin: 0 }}>🎯 서사 및 톤앤매너 설정</h3>
                    <span style={{ fontSize: 11, color: "#d97706", background: "#fff7ed", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>
                      잠정 · 감독 박재인 승인 (U27)
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
                    <div><strong style={{ color: "#64748b" }}>주제 (Theme):</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.theme}</span></div>
                    <div><strong style={{ color: "#64748b" }}>드라마틱 질문:</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.dramatic_question}</span></div>
                    <div><strong style={{ color: "#64748b" }}>톤앤매너 (Tone):</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.tone}</span></div>
                    <div><strong style={{ color: "#64748b" }}>타깃 관객:</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.target_audience}</span></div>
                    <div><strong style={{ color: "#64748b" }}>결말 방향 (Ending Direction):</strong> <span style={{ color: TYPOGRAPHY_THEME.textPrimary }}>{pb.ending_direction}</span></div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 캐릭터 (Character Bible 세분화) 탭 */}
            {tab === "character_bible" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, color: "#2563eb", fontWeight: 800, margin: 0 }}>👤 Character Bible (인물 세분화 & 필드 승인 추적)</h3>
                  <div style={{ display: "flex", gap: 6 }}>
                    {["수현", "민규"].map((cName) => (
                      <button
                        key={cName}
                        onClick={() => setSelectedCharacter(cName)}
                        style={{
                          background: selectedCharacter === cName ? "#2563eb" : "#f1f5f9",
                          color: selectedCharacter === cName ? "#fff" : "#475569",
                          border: "none",
                          borderRadius: 4,
                          padding: "4px 12px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {cName}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ background: "#f8fafc", padding: 20, borderRadius: 8, border: "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a", marginBottom: 14 }}>
                    {char.name} ({char.story_role})
                  </div>
                  
                  {/* 8대 세분화 개별 필드 레일 */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13 }}>
                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <strong style={{ color: "#db2777" }}>Want (표면적 목표):</strong>
                        <span style={{ fontSize: 11, color: "#16a34a" }}>🟢 확정 · 작가 최은서 (U12)</span>
                      </div>
                      <div style={{ color: "#0f172a" }}>{char.external_goal}</div>
                    </div>

                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <strong style={{ color: "#16a34a" }}>Need (내면적 필요):</strong>
                        <span style={{ fontSize: 11, color: "#d97706" }}>🟡 잠정 · 감독 박재인 (U27)</span>
                      </div>
                      <div style={{ color: "#0f172a" }}>{char.internal_need}</div>
                    </div>

                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <strong style={{ color: "#d97706" }}>Wound (과거의 상처):</strong>
                        <span style={{ fontSize: 11, color: "#16a34a" }}>🟢 확정 · 작가 최은서 (U12)</span>
                      </div>
                      <div style={{ color: "#0f172a" }}>{char.wound}</div>
                    </div>

                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <strong style={{ color: "#dc2626" }}>Lie (잘못된 믿음):</strong>
                        <span style={{ fontSize: 11, color: "#64748b" }}>⚪ 검토 필요 (U04)</span>
                      </div>
                      <div style={{ color: "#0f172a" }}>{char.contradiction}</div>
                    </div>

                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <strong style={{ color: "#9333ea" }}>Fear (두려움):</strong>
                        <span style={{ fontSize: 11, color: "#16a34a" }}>🟢 확정 · 작가 최은서 (U12)</span>
                      </div>
                      <div style={{ color: "#0f172a" }}>{char.fear}</div>
                    </div>

                    <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <strong style={{ color: "#2563eb" }}>Arc (인물 변화):</strong>
                        <span style={{ fontSize: 11, color: "#d97706" }}>🟡 잠정 · 감독 박재인 (U27)</span>
                      </div>
                      <div style={{ color: "#0f172a" }}>{char.arc}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. 시각 정렬 (Visual Alignment - 실제 이미지 썸네일 & 2x2 컬럼 그리드) 탭 */}
            {tab === "visual_alignment" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {vAlignIssues.map((issue) => (
                  <div key={issue.id} style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                      <strong style={{ fontSize: 16, color: "#991b1b", fontWeight: 800 }}>⚡ Visual Alignment Issue: "{issue.keyword}"</strong>
                      <span style={{ fontSize: 11, background: "#dc2626", color: "#fff", padding: "3px 10px", borderRadius: 4, fontWeight: 800 }}>시각 기준 충돌 감지</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#0f172a", marginBottom: 12 }}>{issue.summary}</p>
                    
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 12, background: "#ffffff", padding: 14, borderRadius: 8, marginBottom: 12, border: "1px solid #fee2e2" }}>
                      <div><strong style={{ color: "#2563eb" }}>🎬 감독:</strong> {issue.positions.director}</div>
                      <div><strong style={{ color: "#db2777" }}>✍️ 작가:</strong> {issue.positions.writer}</div>
                      <div><strong style={{ color: "#16a34a" }}>🎨 미술:</strong> {issue.positions.art_director}</div>
                      <div><strong style={{ color: "#d97706" }}>🎥 제작:</strong> {issue.positions.producer}</div>
                    </div>

                    <div style={{ fontSize: 13, color: "#d97706", fontWeight: 700 }}>Q. {issue.question}</div>
                  </div>
                ))}

                <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                  <h3 style={{ fontSize: 16, color: "#2563eb", marginBottom: 16, fontWeight: 800 }}>🖼️ 역할별 시각 해석 비교 (Visual Alignment Comparator)</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {vRefs.map((r) => (
                      <div key={r.id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                        {/* 레퍼런스 비주얼 이미지 카네 헤더 */}
                        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, background: "#ffffff", padding: 14, borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ width: "100%", height: 120, background: "#f1f5f9", borderRadius: 6, overflow: "hidden" }}>
                            <img src={(r as any).image_url || (r.id === "R-01" ? "/images/vref_r01.png" : r.id === "R-02" ? "/images/vref_r02.png" : "/images/pool_cinematographer.png")} alt={r.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                              <strong style={{ fontSize: 16, color: "#0f172a", fontWeight: 800 }}>{r.id}: {r.title}</strong>
                              <span style={{ fontSize: 12, background: r.level === "exclude" ? "#dc2626" : "#2563eb", color: "#fff", padding: "3px 10px", borderRadius: 4, fontWeight: 800 }}>
                                {r.level.toUpperCase()}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: "#64748b" }}>{r.uploaded_by}</div>
                          </div>
                        </div>

                        {/* 4대 역할 2x2 분리 비교 컬럼 그리드 */}
                        <div style={{ padding: 16 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12, marginBottom: 14 }}>
                            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: 10, borderRadius: 6 }}>
                              <strong style={{ color: "#1e40af" }}>🎬 DIR 감독 시각 해석:</strong>
                              <div style={{ marginTop: 4, color: "#0f172a" }}>{r.role_interpretations.director || "해석 없음"}</div>
                            </div>
                            <div style={{ background: "#fdf2f8", border: "1px solid #fbcfe8", padding: 10, borderRadius: 6 }}>
                              <strong style={{ color: "#9d174d" }}>✍️ WRT 작가 시각 해석:</strong>
                              <div style={{ marginTop: 4, color: "#0f172a" }}>{r.role_interpretations.writer || "해석 없음"}</div>
                            </div>
                            <div style={{ background: "#fefce8", border: "1px solid #fef08a", padding: 10, borderRadius: 6 }}>
                              <strong style={{ color: "#854d0e" }}>🎨 ART 미술감독 시각 해석:</strong>
                              <div style={{ marginTop: 4, color: "#0f172a" }}>{r.role_interpretations.art_director || "해석 없음"}</div>
                            </div>
                            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: 10, borderRadius: 6 }}>
                              <strong style={{ color: "#166534" }}>🎥 PROD 제작/촬영 시각 해석:</strong>
                              <div style={{ marginTop: 4, color: "#0f172a" }}>{r.role_interpretations.producer || "해석 없음"}</div>
                            </div>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                            <div style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", padding: 8, borderRadius: 6 }}>
                              <strong style={{ color: "#047857" }}>✅ 가져올 요소 (Include):</strong>
                              <div style={{ marginTop: 4, color: "#0f172a" }}>{r.include_elements.length > 0 ? r.include_elements.join(", ") : "없음"}</div>
                            </div>
                            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: 8, borderRadius: 6 }}>
                              <strong style={{ color: "#b91c1c" }}>❌ 배제할 요소 (Exclude):</strong>
                              <div style={{ marginTop: 4, color: "#0f172a" }}>{r.exclude_elements.length > 0 ? r.exclude_elements.join(", ") : "없음"}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 4. 개발 이슈 (Project Development Issues + 파급 영향 Scope) 탭 */}
            {tab === "dev_issues" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 22, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h3 style={{ fontSize: 16, color: "#dc2626", marginBottom: 16, fontWeight: 800 }}>⚡ Scope별 Project Development Issues (파급 영향 범위 연동)</h3>
                {legacyProjectIssues.map((pi) => {
                  const impact = getProjectIssueImpact(pi.issue_id);

                  return (
                    <div key={pi.id} style={{ background: "#fef2f2", border: "1px solid #fca5a5", padding: 16, borderRadius: 8, marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <strong style={{ color: "#991b1b", fontSize: 14 }}>[{pi.scope.toUpperCase()}] {pi.issue_id}: {pi.subject}</strong>
                        <span style={{ fontSize: 11, background: "#dc2626", color: "#fff", padding: "2px 8px", borderRadius: 4, fontWeight: 800 }}>{pi.severity}</span>
                      </div>
                      <p style={{ fontSize: 13, color: "#0f172a", marginBottom: 10 }}>Q: {pi.question}</p>
                      
                      {/* 파급 영향 Scope 표출 레일 */}
                      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 10, color: "#c2410c" }}>
                        💥 <strong>변경 시 파급 영향 범위:</strong> {impact.impactScope.join(", ")}  |  <strong>연관 장면:</strong> {impact.linkedScenes.join(", ")}
                      </div>

                      <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                        {pi.positions.map((p: any, idx: number) => (
                          <div key={idx} style={{ color: "#334155" }}>• <strong>{p.role_label}:</strong> {p.position}</div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* MODE 2: SCENE DEVELOPMENT */}
        {/* ========================================================================= */}
        {mode === "scene_dev" && (
          <div>
            {/*
              지표 바는 세 단으로 읽힌다. 다섯 숫자를 같은 크기로 나열하면 무엇이 급한지 알 수 없다.
                1순위  지금 촬영을 막고 있는가        — 빨강, 가장 크게
                2순위  이 장면이 얼마나 정리됐는가    — 파랑
                3순위  나머지 참고 수치              — 구분선 뒤 회색 한 줄
            */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, background: "#ffffff", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0", flexWrap: "wrap", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
              <span style={{ fontSize: 13, background: blockers.length > 0 ? "#dc2626" : "#16a34a", color: "#fff", padding: "4px 10px", borderRadius: 4, fontWeight: 800 }}>
                {blockers.length > 0 ? `🔴 제작 차단 ${blockers.length}건` : "🟢 준비 완료"}
              </span>
              <span style={{ fontSize: 13, color: "#334155", fontWeight: 700 }}>
                장면 확인 항목 <strong style={{ color: "#2563eb", fontSize: 15 }}>{scoreResult.breakdown.length}건</strong>
              </span>
              <span aria-hidden style={{ width: 1, height: 14, background: "#e2e8f0" }} />
              <span style={{ fontSize: 11, color: "#94a3b8" }}>
                열린 이슈 {openIssues.length} · 미결정 질문 {roleUnresolved.length} · 쇼트 {props.shots.length}컷 제안
              </span>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                style={{ background: "transparent", border: "none", color: "#2563eb", fontSize: 11, cursor: "pointer", fontWeight: 700, marginLeft: "auto" }}
              >
                {showBreakdown ? "▲ 세부 지표 접기" : "▼ 세부 지표 보기"}
              </button>
            </div>

            {showBreakdown && (
              <div style={{ margin: "-8px 0 16px 0", padding: 14, background: "#ffffff", border: "1px solid #bfdbfe", borderRadius: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, color: "#1d4ed8" }}>📊 장면 확인 항목 세부 내역</strong>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  {scoreResult.breakdown.map((item) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", borderRadius: 4, background: "#f8fafc" }}>
                      <span>[{item.severity.toUpperCase()}] {item.label}</span>
                      <strong style={{ color: "#dc2626" }}>확인 필요</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 0-0. 🎬 현장 지휘 센터 (On-Set Command Center) 탭 (기본/메인) */}
            {(tab === "on_set_command_center" || !tab) && (
              // 이전에는 발언을 없는 컬럼(raw_text·text)으로 옮겨 전부 빈 문자열이 되었고, 규칙 탐지가 0건이면
              // 코드에 적힌 "인물 존재 여부 충돌" 안건을 대신 보여 줬다. 이제 해석 차이 분석(v2) 결과만 쓴다.
              <OnSetCommandCenter meetingId={props.meetingId} alignment={props.alignmentV2 ?? null} />
            )}

            {/* 1. 쇼트보드 탭 */}
            {tab === "shotboard" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <div data-testid="intent-coverage-panel" style={{ marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid #e2e8f0" }}>
                  <h3 style={{ fontSize: 16, color: "#2563eb", fontWeight: 800, marginBottom: 12 }}>🎯 Intent Coverage</h3>
                  {props.intentCoverage.loadError ? (
                    <div data-testid="intent-coverage-error" style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 12, color: "#991b1b", fontSize: 13 }}>
                      ⚠️ 불러오지 못했습니다: {props.intentCoverage.loadError}
                    </div>
                  ) : props.intentCoverage.reports.length === 0 ? (
                    <p data-testid="intent-coverage-empty" style={{ fontSize: 13, color: "#64748b" }}>이 장면에 등록된 의도가 없습니다.</p>
                  ) : (
                    props.intentCoverage.reports.map((r) => (
                      <div key={r.intent.id} data-testid={`coverage-report-${r.intent.id}`} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <strong style={{ color: "#0f172a", fontSize: 13 }}>{r.intent.id} · {INTENT_LABEL[r.intent.type]}</strong>
                          <span style={{ fontSize: 11, color: r.status === "covered" ? "#16a34a" : "#d97706", fontWeight: 700 }}>{COVERAGE_STATUS_LABEL[r.status]}</span>
                        </div>
                        <p style={{ fontSize: 13, color: "#334155", margin: "4px 0" }}>{r.intent.text}</p>
                        <p style={{ fontSize: 12, color: "#64748b", margin: "4px 0" }}>{r.message}</p>
                        {r.claims
                          .filter((c) => c.link.coverage_verification_state === "proposed")
                          .map((c) => (
                            <button
                              key={c.link.id}
                              data-testid="coverage-verify-action"
                              onClick={() => verifyClaim(c.link.id)}
                              disabled={verifyingLinkId === c.link.id}
                              style={{ fontSize: 11, background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, padding: "4px 8px", marginTop: 6, marginRight: 6, cursor: "pointer" }}
                            >
                              {verifyingLinkId === c.link.id ? "확인 중..." : `쇼트 ${c.shot_number} 감독 확인`}
                            </button>
                          ))}
                      </div>
                    ))
                  )}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, color: "#16a34a", fontWeight: 800, margin: 0 }}>🎬 쇼트보드 콘티 (총 {props.shots.length}컷)</h3>
                  <span style={{ fontSize: 12, color: "#64748b" }}>{sceneNumber} 콘티 · 쇼트 {props.shots.length}컷</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 18 }}>
                  {props.shots.map((s) => {
                    const evidenceList = parseJson<string[]>(s.evidence, []);
                    const isExpanded = expandedDetails[s.id] ?? false;

                    // image_state 는 DB 가 정한다. 화면이 스스로 "생성됨"으로 바꾸지 않는다.
                    // 그렇게 하면 승인 버튼이 열리지만 서버(store.updateShot)는 여전히
                    // image_state='not_generated' 를 보고 400 을 돌려주므로, 누르는 순간 실패한다.
                    // 데모에 이미지를 넣고 싶으면 픽스처에 image_url 을 넣어 시드한다.
                    const imageState = (s as unknown as { image_state?: ImageState }).image_state ?? "not_generated";
                    const imageReady = imageState === "generated";
                    const isApproved = s.status === "approved";
                    // 번들에 들어있는 정적 파일은 파이프라인이 만든 결과물이 아니다. 3단계 비교 화면과
                    // 같은 문구로 그렇게 표시한다.
                    const isDemoAsset = !!s.image_url && s.image_url.startsWith("/images/");

                    return (
                      <div key={s.id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ padding: "8px 12px", background: "#ffffff", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0" }}>
                          <div style={{ fontSize: 13, fontWeight: 900, color: "#2563eb" }}>
                            SHOT 0{s.shot_number} · {s.shot_size} · {s.lens}
                          </div>
                          <span
                            data-testid={`shot-${s.shot_number}-status-badge`}
                            style={{
                              fontSize: 11,
                              background: isApproved ? "#16a34a" : imageReady ? "#2563eb" : "#d97706",
                              color: "#fff",
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontWeight: 800,
                            }}
                          >
                            {isApproved
                              ? "✅ 최종 승인됨"
                              : imageReady
                                ? "🔵 이미지 생성됨 · 승인 대기"
                                : "🟡 구도 제안만 등록됨 · 최종 승인 불가"}
                          </span>
                        </div>

                        {/*
                          image_url 이 없으면 이미지를 만들지 않은 것이다. 예전에는 그 자리에
                          /images/shot{n}.png 를 대신 넣었는데, 그 파일들은 SCENE 12 모텔방 사진이라
                          SCENE 34 수영장 콘티 설명 밑에 다른 장면 사진이 붙어 나왔다. 게다가 바로 아래
                          버튼은 같은 카드에서 "이미지 미생성" 이라고 말하고 있었다.
                          없으면 없다고 표시한다. 다른 장면 사진으로 채우지 않는다.
                        */}
                        <div style={{ position: "relative", width: "100%", height: 180, background: "#f1f5f9", borderBottom: "1px solid #e2e8f0", overflow: "hidden" }}>
                          {s.image_url ? (
                            <>
                              <img
                                src={s.image_url}
                                alt={`Shot ${s.shot_number}`}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                              {isDemoAsset && (
                                <div style={{ position: "absolute", top: 6, left: 8, background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 800 }}>
                                  ⚠️ 데모용 사전 생성 이미지
                                </div>
                              )}
                            </>
                          ) : (
                            <div
                              data-testid={`shot-${s.shot_number}-image-not-generated`}
                              data-image-state={imageState}
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 6,
                                background:
                                  "repeating-linear-gradient(135deg, #f1f5f9 0 10px, #e9eef5 10px 20px)",
                                color: "#94a3b8",
                              }}
                            >
                              <span style={{ fontSize: 13, fontWeight: 800 }}>🔒 이미지 미생성</span>
                              <span style={{ fontSize: 11 }}>
                                SHOT {String(s.shot_number).padStart(2, "0")} · {s.shot_size} · {s.lens}
                              </span>
                              <span style={{ fontSize: 10 }}>합의 확정 후 생성됩니다</span>
                            </div>
                          )}
                          <div style={{ position: "absolute", bottom: 6, left: 8, background: "rgba(255,255,255,0.9)", color: "#0f172a", padding: "2px 6px", borderRadius: 4, fontSize: 11, fontWeight: 700, border: "1px solid #e2e8f0" }}>
                            무빙: {s.camera_move}
                          </div>
                        </div>

                        <div style={{ padding: 14 }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", marginBottom: 6, lineHeight: 1.4 }}>
                            {s.character_action}
                          </div>
                          <div style={{ fontSize: 12, color: "#2563eb", marginBottom: 10 }}>
                            <strong>의도:</strong> {s.purpose}
                          </div>

                          <div style={{ marginBottom: 8 }}>
                            <button
                              data-testid={`shot-${s.shot_number}-approve-button`}
                              // approveShot 은 정의만 되어 있고 어디서도 호출되지 않았다. 버튼은
                              // 활성/비활성과 문구만 바뀌었을 뿐 눌러도 아무 일도 일어나지 않았다.
                              onClick={() => approveShot(s.id)}
                              disabled={!imageReady || isApproved || approvingShotId === s.id}
                              style={{
                                width: "100%",
                                background: !imageReady || isApproved ? "#e2e8f0" : "#16a34a",
                                color: !imageReady ? "#94a3b8" : "#fff",
                                border: "none",
                                borderRadius: 4,
                                padding: "6px 8px",
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: !imageReady || isApproved ? "not-allowed" : "pointer",
                              }}
                            >
                              {isApproved
                                ? "✅ 최종 승인됨"
                                : !imageReady
                                  ? "🔒 이미지 미생성 — 최종 승인 불가"
                                  : approvingShotId === s.id
                                    ? "승인 처리 중…"
                                    : "최종 승인"}
                            </button>
                          </div>

                          <button
                            onClick={() => toggleDetail(s.id)}
                            style={{ width: "100%", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 4, padding: "5px 8px", color: "#475569", fontSize: 11, cursor: "pointer", fontWeight: 700 }}
                          >
                            {isExpanded ? "▲ 제작 체크 및 근거 접기" : `▼ 제작 체크 및 근거 보기 (${evidenceList.length}건)`}
                          </button>

                          {isExpanded && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: TYPOGRAPHY_THEME.textPrimary, background: "#ffffff", padding: 8, borderRadius: 6, marginTop: 6, border: "1px solid #e2e8f0" }}>
                              <div>• <strong style={{ color: "#db2777" }}>대사/음향:</strong> {s.dialogue_sound || "없음"}</div>
                              <div>• <strong style={{ color: "#d97706" }}>현장 체크:</strong> {s.production_check || "이상 없음"}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                <span style={{ fontSize: 11, color: TYPOGRAPHY_THEME.textMuted }}>근거 발언:</span>
                                {evidenceList.map((uid) => (
                                  <span
                                    key={uid}
                                    style={{ fontSize: 11, background: TYPOGRAPHY_THEME.uidMonospaceBg, color: TYPOGRAPHY_THEME.uidMonospaceColor, fontFamily: "monospace", border: "1px solid #cbd5e1", padding: "1px 6px", borderRadius: 4, cursor: "pointer" }}
                                    onClick={() => {
                                      setTab("transcript");
                                      setSelectedUid(uid);
                                      setActiveEvidenceList(evidenceList);
                                    }}
                                  >
                                    {uid}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. 회의 전사 탭 */}
            {tab === "transcript" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                {/* 발표용 핵심 흐름 강하게 강조 (AI가 주목한 핵심 발언) */}
                <div style={{ backgroundColor: "#F8FAFC", border: "2px solid #2563EB", borderRadius: 16, padding: "24px", marginBottom: 28, boxShadow: "0 4px 12px rgba(37,99,235,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: 28 }}>🤖</span>
                      <h2 style={{ fontSize: 24, fontWeight: 900, color: "#1E293B", margin: 0 }}>
                        AI가 주목한 발언 <span style={{ fontSize: 16, color: "#2563EB", fontWeight: 800 }}>(발표 핵심 요약 4건)</span>
                      </h2>
                    </div>
                    <a
                      href={`/m/${props.meetingId}/alignment`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "8px",
                        backgroundColor: "#2563EB",
                        color: "#FFFFFF",
                        fontSize: 15,
                        fontWeight: 900,
                        padding: "12px 20px",
                        borderRadius: 12,
                        textDecoration: "none",
                        boxShadow: "0 4px 10px rgba(37,99,235,0.25)",
                        transition: "background 0.2s",
                      }}
                    >
                      <span>👉 다음 단계: 다시 짚기 (Alignment Check)로 이동</span>
                      <span>→</span>
                    </a>
                  </div>
                  <p style={{ fontSize: 15, color: "#4B5563", margin: "0 0 16px 0", fontWeight: 600 }}>
                    전체 80개 회의 발언 중 시각적 동상이몽(충돌 및 모호함)을 야기하는 결정적인 발언을 AI가 실시간으로 분석해 냈습니다.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                    {[
                      { uid: "U-001", speaker: "한지우 (감독)", roleBadge: "🎬 감독", text: "인물 없는 텅 빈 수영장 공간이었으면 좋겠습니다.", tag: "⚡ 인물 존재 여부 충돌", color: "#EF4444", bg: "#FEF2F2", border: "#FCA5A5" },
                      { uid: "U-002", speaker: "서민재 (촬영감독)", roleBadge: "🎥 촬영", text: "인물을 멀리 작게 남기는 와이드 샷이 감정 잡기에 좋습니다.", tag: "⚡ 인물 존재 여부 충돌", color: "#EF4444", bg: "#FEF2F2", border: "#FCA5A5" },
                      { uid: "U-003", speaker: "오세라 (미술감독)", roleBadge: "🎨 미술", text: "청록빛 젖은 타일 반사를 꼭 살리고 폐허처럼 부서진 질감을 주죠.", tag: "🧐 공간 노후도 미확인", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
                      { uid: "U-005", speaker: "강태수 (제작PD)", roleBadge: "💼 제작", text: "현장에서 과한 조명은 금지하고 차갑게 가죠.", tag: "❓ 차가움의 시각 표현", color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" },
                    ].map((item) => (
                      <div key={item.uid} style={{ backgroundColor: "#FFFFFF", border: "1px solid #CBD5E1", borderRadius: 12, padding: "16px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <span style={{ fontSize: 13, fontWeight: 900, color: "#1E293B" }}>{item.roleBadge} {item.speaker.split(" ")[0]}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: item.color, backgroundColor: item.bg, border: `1px solid ${item.border}`, padding: "2px 8px", borderRadius: 6 }}>
                              {item.tag}
                            </span>
                          </div>
                          <p style={{ fontSize: 15, fontWeight: 700, color: "#1E293B", margin: 0, lineHeight: 1.5 }}>
                            "{item.text}"
                          </p>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#64748B" }}>
                          📌 발언 번호: {item.uid}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 14, borderBottom: "1px solid #e2e8f0", paddingBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h3 style={{ fontSize: 16, color: "#2563eb", fontWeight: 900, margin: 0 }}>💬 회의 전사 (Transcript)</h3>
                      <span style={{ fontSize: 12, color: TYPOGRAPHY_THEME.textMuted }}>
                        표시 중: {filteredUtterances.length} / {props.utterances.length}개 발언
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="text"
                        data-testid="transcript-search-input"
                        placeholder="🔍 회의 발언, 발화자, U-ID, 이슈 키워드 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ background: "#f8fafc", border: "1px solid #cbd5e1", color: "#0f172a", borderRadius: 6, padding: "6px 12px", fontSize: 12, width: 280, outline: "none" }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ color: TYPOGRAPHY_THEME.textMuted, marginRight: 4 }}>의미 필터:</span>
                      {[
                        { key: "all", label: "전체" },
                        { key: "decision", label: "✅ 확정/결정" },
                        { key: "unresolved", label: "❓ 미결정" },
                        { key: "issue_evidence", label: "⚡ 이슈 근거" },
                        { key: "shot_evidence", label: "🎬 쇼트 근거" },
                      ].map((f) => (
                        <button
                          key={f.key}
                          onClick={() => setSemanticFilter(f.key as SemanticFilterType)}
                          style={{
                            background: semanticFilter === f.key ? "#2563eb" : "#f1f5f9",
                            color: semanticFilter === f.key ? "#fff" : "#475569",
                            border: "none",
                            borderRadius: 4,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ color: TYPOGRAPHY_THEME.textMuted, marginRight: 4 }}>역할:</span>
                      {ROLES.map((r) => (
                        <button
                          key={r}
                          onClick={() => setRole(r)}
                          style={{
                            background: role === r ? "#2563eb" : "#f1f5f9",
                            color: role === r ? "#fff" : "#475569",
                            border: "none",
                            borderRadius: 4,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {evidenceNavInfo && evidenceNavInfo.index !== -1 && (
                  <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "8px 14px", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 800 }}>
                      🎯 근거 [{selectedUid}] 이동 중 ({evidenceNavInfo.index}/{evidenceNavInfo.total}번째)
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        disabled={!evidenceNavInfo.prevUid}
                        onClick={() => setSelectedUid(evidenceNavInfo.prevUid)}
                        style={{ background: "#ffffff", color: evidenceNavInfo.prevUid ? "#0f172a" : "#cbd5e1", border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: evidenceNavInfo.prevUid ? "pointer" : "not-allowed" }}
                      >
                        ◀ 이전 근거
                      </button>
                      <button
                        disabled={!evidenceNavInfo.nextUid}
                        onClick={() => setSelectedUid(evidenceNavInfo.nextUid)}
                        style={{ background: "#ffffff", color: evidenceNavInfo.nextUid ? "#0f172a" : "#cbd5e1", border: "1px solid #cbd5e1", borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: evidenceNavInfo.nextUid ? "pointer" : "not-allowed" }}
                      >
                        다음 근거 ▶
                      </button>
                      <button
                        onClick={() => { setSelectedUid(null); setActiveEvidenceList([]); }}
                        style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: "pointer" }}
                      >
                        돌아가기 ✖
                      </button>
                    </div>
                  </div>
                )}

                {hoveredUidNode && (
                  <div style={{ position: "fixed", bottom: 20, right: 20, background: "#ffffff", border: "1px solid #bfdbfe", borderRadius: 8, padding: 12, zIndex: 100, boxShadow: "0 4px 14px rgba(0,0,0,0.1)", maxWidth: 320 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#2563eb", marginBottom: 4 }}>
                      🔗 U-ID [{hoveredUidNode.uid}] 연결 노드
                    </div>
                    {hoveredUidNode.issues.length > 0 && (
                      <div style={{ fontSize: 11, color: "#dc2626", marginBottom: 4 }}>
                        ⚡ 연결된 이슈: {hoveredUidNode.issues.join(", ")}
                      </div>
                    )}
                    {hoveredUidNode.shots.length > 0 && (
                      <div style={{ fontSize: 11, color: "#16a34a" }}>
                        🎬 연결된 샷: SHOT 0{hoveredUidNode.shots.join(", 0")}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 720, overflowY: "auto", paddingRight: 6 }}>
                  {filteredUtterances.map((u) => {
                    const isSelected = selectedUid === u.uid;
                    const roleStyle = ROLE_BADGE_STYLE[u.role || ""] || { bg: "#f1f5f9", color: "#475569", border: "#cbd5e1", label: u.role || "참석자" };

                    return (
                      <article
                        key={u.id}
                        id={`u_${u.uid}`}
                        data-testid={`transcript-unit-${u.uid}`}
                        style={{
                          fontSize: 13,
                          padding: "10px 14px",
                          background: isSelected ? "#eff6ff" : "#f8fafc",
                          border: `1px solid ${isSelected ? "#2563eb" : "#e2e8f0"}`,
                          borderLeft: isSelected ? "4px solid #2563eb" : "1px solid #e2e8f0",
                          borderRadius: 6,
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              onMouseEnter={() => handleUidMouseEnter(u.uid)}
                              onMouseLeave={() => setHoveredUidNode(null)}
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: isSelected ? "#2563eb" : TYPOGRAPHY_THEME.uidMonospaceColor,
                                background: TYPOGRAPHY_THEME.uidMonospaceBg,
                                fontFamily: "monospace",
                                padding: "1px 6px",
                                borderRadius: 3,
                                border: "1px solid #cbd5e1",
                                cursor: "pointer",
                              }}
                            >
                              {u.uid}
                            </span>
                            <span style={{ fontSize: 11, color: TYPOGRAPHY_THEME.textMuted }}>{u.ts_start || "00:00"}</span>
                            <strong style={{ color: TYPOGRAPHY_THEME.textPrimary, fontSize: 13, fontWeight: 800 }}>
                              {u.speaker_name}
                            </strong>
                            <span data-testid={`role-badge-${u.role}`} style={{ fontSize: 10, fontWeight: 700, background: roleStyle.bg, color: roleStyle.color, border: `1px solid ${roleStyle.border}`, padding: "1px 6px", borderRadius: 3 }}>
                              {roleStyle.label}
                            </span>
                          </div>
                        </div>

                        <p style={{ margin: 0, color: TYPOGRAPHY_THEME.textPrimary, lineHeight: 1.55, fontSize: 13.5, fontWeight: 400 }}>
                          {u.text_raw}
                        </p>

                        {u.stage_direction && (
                          <div style={{ fontSize: 11, color: TYPOGRAPHY_THEME.stageDirectionColor, marginTop: 4, fontStyle: "italic", background: "#f1f5f9", padding: "4px 8px", borderRadius: 3, borderLeft: "3px solid #94a3b8" }}>
                            지문: {u.stage_direction}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. 장면 명세 (Brief - 4단계 정직한 세분화 상태) 탭 */}
            {tab === "brief" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h3 style={{ fontSize: 16, color: "#2563eb", marginBottom: 16, fontWeight: 800 }}>📋 장면 명세 (Brief - 4단계 정직 상태 분류)</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {props.briefItems.map((b) => {
                    const st = classifyBriefState(b.field);

                    return (
                      <div key={b.id} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", padding: 12, borderRadius: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <strong style={{ color: "#64748b", fontSize: 12 }}>{SCENE_BRIEF_LABEL[b.field as SceneBriefField] ?? b.field}</strong>
                          <span style={{ fontSize: 11, background: st.bg, color: "#fff", padding: "2px 8px", borderRadius: 4, fontWeight: 800 }}>
                            {st.label}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, marginTop: 4, color: TYPOGRAPHY_THEME.textPrimary, fontWeight: 700 }}>{b.user_value ?? b.ai_value}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. 장면 이슈 탭 */}
            {tab === "issues" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                {/*
                  승인 완료와 승인 대기는 정반대 상태다. 한 목록에 섞어놓고 배경색만 다르게 하면
                  "무엇이 이미 확정됐는지"를 색으로 유추해야 한다. 섹션 자체를 나누고 건수를 붙인다.
                */}
                {props.decisions.length === 0 && (
                  <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>아직 기록된 결정이 없습니다.</p>
                )}
                {(
                  [
                    {
                      approved: true,
                      title: "✅ 승인 완료",
                      note: "사람이 승인한 결정입니다. 이대로 제작에 반영됩니다.",
                      color: "#16a34a",
                      items: props.decisions.filter((d) => d.verification_state === "approved"),
                    },
                    {
                      approved: false,
                      title: "🕐 승인 대기",
                      note: "아직 확정 전입니다. 승인 전에는 제작에 반영되지 않습니다.",
                      color: "#475569",
                      items: props.decisions.filter((d) => d.verification_state !== "approved"),
                    },
                  ] as const
                ).map((group) =>
                  group.items.length === 0 ? null : (
                    <section key={group.title} style={{ marginBottom: 20 }}>
                      <h3 style={{ fontSize: 15, color: group.color, margin: "0 0 2px", fontWeight: 800 }}>
                        {group.title} <span style={{ fontSize: 13 }}>({group.items.length}건)</span>
                      </h3>
                      <p style={{ fontSize: 11, color: "#94a3b8", margin: "0 0 10px" }}>{group.note}</p>
                      {group.items.map((d) => (
                        <div
                          key={d.did}
                          style={{
                            background: group.approved ? "#f0fdf4" : "#f8fafc",
                            border: group.approved ? "1px solid #bbf7d0" : "1px solid #cbd5e1",
                            padding: 12,
                            borderRadius: 8,
                            marginBottom: 10,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                            <strong style={{ color: group.approved ? "#15803d" : "#0f172a", fontSize: 13 }}>{d.did}</strong>
                            <span style={{ fontSize: 11, color: "#64748b" }}>
                              {group.approved
                                ? `승인 ${d.approved_by ?? ""}`
                                : (STATE_LABEL[d.decision_state as DecisionState] ?? d.decision_state)}
                            </span>
                          </div>
                          <p style={{ fontSize: 13, color: TYPOGRAPHY_THEME.textPrimary, margin: 0 }}>{d.user_value ?? d.ai_value}</p>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{parseJson<string[]>(d.evidence, []).join(" ")}</div>
                        </div>
                      ))}
                    </section>
                  ),
                )}

                <h3 style={{ fontSize: 15, color: "#dc2626", margin: "24px 0 12px", fontWeight: 800 }}>
                  ⚡ 장면 이슈 (Scene Issues) <span style={{ fontSize: 13, color: "#94a3b8" }}>{props.sceneIssues.length}건</span>
                </h3>
                {props.sceneIssues.map((i, idx) => {
                  const isCritical = i.severity === "critical";
                  // 감지 사유가 없으면 question 을 그대로 되풀이하지 않는다 (같은 문장 2회 출력 방지).
                  const reason = (i as any).detection_reason as string | undefined;

                  return (
                    <div key={i.issue_id || `si_${idx}`} style={{ background: isCritical ? "#fef2f2" : "#fff7ed", border: isCritical ? "1px solid #fca5a5" : "1px solid #fed7aa", borderLeft: isCritical ? "4px solid #dc2626" : "4px solid #d97706", padding: 14, borderRadius: 8, marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong style={{ color: isCritical ? "#991b1b" : "#c2410c", fontSize: 14 }}>[{i.severity.toUpperCase()}] {i.issue_id}: {i.subject}</strong>
                        <span style={{ fontSize: 11, background: isCritical ? "#dc2626" : "#d97706", color: "#fff", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>
                          {i.status === "open" ? "🔴 검토 미해결" : "🟢 해결됨"}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, color: TYPOGRAPHY_THEME.textPrimary, margin: "6px 0", fontWeight: 700 }}>Q: {i.question}</p>
                      {reason && reason !== i.question && (
                        <div style={{ fontSize: 12, color: "#64748b" }}>감지 사유: {reason}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 5. 프리비즈 탭 */}
            {tab === "previs" && (
              <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                <h3 style={{ fontSize: 16, color: "#2563eb", marginBottom: 16, fontWeight: 800 }}>🎥 프리비즈 (Previs) 3D 시뮬레이션</h3>
                <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, marginBottom: 20 }}>
                  Shot Board {props.shots.length}컷의 카메라 무빙 및 렌즈 공간 시뮬레이션 패널입니다.
                </p>

                <div data-testid="production-impact-panel">
                  <h3 style={{ fontSize: 14, color: "#0f172a", marginBottom: 12 }}>변경 영향 — 재검토 필요 자산</h3>
                  {!props.intentCoverage.productionImpacts.length && (
                    <p style={{ fontSize: 13, color: "#64748b" }}>해당 항목 없음.</p>
                  )}
                  {props.intentCoverage.productionImpacts.map((impact) => (
                    <div key={impact.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
                      <span style={{ fontSize: 13, color: TYPOGRAPHY_THEME.textPrimary }}>{impact.label}</span>
                      <span style={{ fontSize: 11, color: impact.status === "current" ? "#16a34a" : "#d97706", fontWeight: 700 }}>{impact.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
