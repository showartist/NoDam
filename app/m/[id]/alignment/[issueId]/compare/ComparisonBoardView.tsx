"use client";

import React, { useState } from "react";
import type {
  ConsolidatedExplorationRecipe,
  ParticipantExplorationRecipe,
  SelectedVisualElement,
} from "@/lib/domain/explorationRecipe/types";
import { checkRecipeCompleteness } from "@/lib/domain/explorationRecipe/completeness";
import { buildProviderPayloadPreview } from "@/lib/domain/explorationRecipe/providerPreview";
import { createConsolidatedExplorationRecipe } from "@/lib/domain/explorationRecipe/consolidated";

interface ComparisonBoardViewProps {
  projectId: string;
  meetingId?: string;
  issueId: string;
  recipes: ParticipantExplorationRecipe[];
}

export function ComparisonBoardView(props: ComparisonBoardViewProps) {
  const [selectedElementsMap, setSelectedElementsMap] = useState<Record<string, SelectedVisualElement>>({});
  const [consolidatedRecipe, setConsolidatedRecipe] = useState<ConsolidatedExplorationRecipe | null>(null);
  const [expandedTechInfo, setExpandedTechInfo] = useState<Record<string, boolean>>({});

  const handleSelectElement = (
    category: SelectedVisualElement["category"],
    recipe: ParticipantExplorationRecipe,
    value: string
  ) => {
    setSelectedElementsMap((prev) => ({
      ...prev,
      [category]: {
        category,
        sourceRecipeId: recipe.id,
        sourceParticipantId: recipe.participantId,
        sourceParticipantRole: recipe.participantRole,
        selectedValue: value,
        selectedBy: "한지우(감독)",
        selectedAt: new Date().toISOString(),
        evidenceUids: recipe.evidenceUids,
      },
    }));
  };

  const handleBuildConsolidatedRecipe = () => {
    const selectedList = Object.values(selectedElementsMap);
    if (selectedList.length === 0) {
      alert("최소 1개 이상의 시각 요소를 선택해 주세요.");
      return;
    }

    const version = consolidatedRecipe ? consolidatedRecipe.version + 1 : 1;
    const consolidated = createConsolidatedExplorationRecipe(
      props.issueId,
      props.recipes,
      selectedList,
      "한지우(감독)",
      version
    );

    // Persist via API
    fetch("/api/alignment/recipe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "consolidated", recipe: consolidated }),
    }).catch((err) => console.error("Persist consolidated recipe error:", err));

    setConsolidatedRecipe(consolidated);
  };

  const CATEGORY_ROWS: { key: SelectedVisualElement["category"]; label: string; sublabel: string }[] = [
    { key: "composition", label: "구도", sublabel: "Shot Composition & Lens" },
    { key: "subjectPresence", label: "인물 존재 여부", sublabel: "Subject Presence" },
    { key: "colorIntent", label: "색감 및 톤", sublabel: "Color Palette & Mood" },
  ];

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1520px",
        margin: "0 auto",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, Pretendard, 'Inter', sans-serif",
        color: "#171A1F",
        display: "flex",
        flexDirection: "column",
        gap: "28px",
      }}
    >
      {/* 1. Header Banner */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #CBD5E1",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 800, color: "#2563EB", marginBottom: "6px" }}>
            <span>🖼️ 3단계: 관점 비교 (Perspective Comparison)</span>
            <span>•</span>
            <span style={{ color: "#4B5563" }}>SCENE 34</span>
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 900, color: "#111827", margin: 0, letterSpacing: "-0.5px" }}>
            같은 말을 세 사람은 이렇게 다르게 상상했습니다.
          </h1>
          <p style={{ fontSize: "16px", fontWeight: 600, color: "#4B5563", margin: "6px 0 0 0" }}>
            각 직군별 관점을 대조하고, 최종 통합 장면안에 반영할 최적의 시각 요소를 직접 선택하세요.
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#EFF6FF",
            border: "1px solid #BFDBFE",
            color: "#2563EB",
            padding: "10px 18px",
            borderRadius: "12px",
            fontSize: "15px",
            fontWeight: 900,
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>선택된 요소:</span>
          <span style={{ fontSize: "18px", fontWeight: 900 }}>{Object.keys(selectedElementsMap).length} / 3</span>
        </div>
      </div>

      {/* 2. 3-Column Side-by-Side Perspective Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px" }}>
        {props.recipes.map((recipe, idx) => {
          const completeness = checkRecipeCompleteness(recipe);
          const payloadPreview = buildProviderPayloadPreview(recipe);
          const showTech = expandedTechInfo[recipe.id] ?? false;

          const roleTitle =
            recipe.participantRole === "director"
              ? "🎬 감독 관점"
              : recipe.participantRole === "cinematographer"
              ? "🎥 촬영감독 관점"
              : "🎨 미술감독 관점";

          // 데모 시연용 사전 생성 이미지 자막 및 실제 고화질 영화 시네마틱 이미지 URL 매칭
          const demoImageCaption =
            recipe.participantRole === "director"
              ? "인물 없는 텅 빈 수영장"
              : recipe.participantRole === "cinematographer"
              ? "멀리 작은 인물이 있는 와이드 샷"
              : "청록빛 젖은 타일 반사 중심";

          // SCENE 34 실내 수영장 데모용 사전 생성 이미지.
          // 로컬 자산만 쓴다 — 발표 중 외부 네트워크 지연·실패로 렌더가 깨지지 않게 한다.
          const demoImageUrl =
            recipe.participantRole === "director"
              // 감독안: 인물이 전혀 없는 폐장 후 실내 수영장
              ? "/images/pool_director.png"
              : recipe.participantRole === "cinematographer"
              // 촬영감독안: 수영하지 않는 인물이 먼 배경/가장자리에 아주 작게 존재하는 와이드숏
              ? "/images/pool_cinematographer.png"
              // 미술감독안: 청록빛과 젖은 타일 반사, 수영장 공간 질감 중심
              : "/images/pool_art_director.png";

          const bgGradients = [
            "linear-gradient(135deg, #1E293B 0%, #334155 100%)",
            "linear-gradient(135deg, #311A2E 0%, #1E293B 100%)",
            "linear-gradient(135deg, #1A2E26 0%, #0F172A 100%)",
          ];

          return (
            <div
              key={recipe.id}
              style={{
                backgroundColor: "#FFFFFF",
                border: "1px solid #CBD5E1",
                borderRadius: "16px",
                padding: "22px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "18px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                {/* Card Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0, fontSize: "19px", fontWeight: 900, color: "#111827" }}>
                    {roleTitle} <span style={{ fontSize: "15px", color: "#4B5563", fontWeight: 700 }}>({recipe.participantName})</span>
                  </h3>
                  <span title="회의 녹화 근거 ID" style={{ fontSize: "11px", fontWeight: 600, fontFamily: "monospace", color: "#9CA3AF", backgroundColor: "transparent", padding: "3px 6px", borderRadius: "6px" }}>
                    근거 {recipe.evidenceUids.join(", ")}
                  </span>
                </div>

                {/* Editorial Demo Pre-Generated Image Banner with Realistic High-Res Cinema Still */}
                <div
                  style={{
                    height: "230px",
                    backgroundColor: "#1E293B",
                    borderRadius: "14px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "14px",
                    border: "2px solid #334155",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={demoImageUrl}
                    alt={demoImageCaption}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      zIndex: 0,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.85) 100%)",
                      zIndex: 1,
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-start", zIndex: 2 }}>
                    <span
                      style={{
                        backgroundColor: "#F59E0B",
                        color: "#000000",
                        fontWeight: 900,
                        fontSize: "13px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <span>⚠️</span>
                      <span>데모용 사전 생성 이미지</span>
                    </span>
                  </div>

                  <div
                    style={{
                      backgroundColor: "rgba(0,0,0,0.6)",
                      backdropFilter: "blur(6px)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      textAlign: "center",
                      zIndex: 2,
                    }}
                  >
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#E2E8F0", marginBottom: "2px" }}>
                      🎬 데모용 관점 시각화
                    </div>
                    <div style={{ fontSize: "16px", fontWeight: 900, color: "#FFFFFF", letterSpacing: "-0.3px" }}>
                      "{demoImageCaption}"
                    </div>
                  </div>
                </div>

                {/* Interpretation Quote */}
                <div style={{ backgroundColor: "#F8FAFC", border: "1px solid #CBD5E1", borderRadius: "12px", padding: "16px" }}>
                  <p style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#111827", lineHeight: "1.5" }}>
                    "{recipe.interpretation}"
                  </p>
                </div>

                {/* Collapsible Tech Info Drawer */}
                <div>
                  <button
                    onClick={() =>
                      setExpandedTechInfo({ ...expandedTechInfo, [recipe.id]: !showTech })
                    }
                    style={{
                      fontSize: "13px",
                      fontWeight: 800,
                      color: "#4B5563",
                      backgroundColor: "transparent",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: 0,
                    }}
                  >
                    <span>⚙️ AI 생성 세부정보 보기</span>
                    <span>{showTech ? "▲" : "▼"}</span>
                  </button>

                  {showTech && (
                    <div
                      style={{
                        marginTop: "10px",
                        padding: "12px",
                        backgroundColor: "#F3F4F6",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontFamily: "monospace",
                        color: "#374151",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                      }}
                    >
                      <div>[AI 프롬프트]: {payloadPreview.promptPayload.slice(0, 100)}...</div>
                      <div>[AI 엔진]: {payloadPreview.selectedProvider} ({payloadPreview.model})</div>
                      <div>[데이터 완결도]: {completeness.status === "ready" ? "완벽 준비 (Ready)" : "검토 필요 (" + completeness.status + ")"}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Categorized Element Selector Rows */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #CBD5E1",
          borderRadius: "16px",
          padding: "26px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
          display: "flex",
          flexDirection: "column",
          gap: "22px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "24px", fontWeight: 900, color: "#111827" }}>
            🔍 카테고리별 관점 요소 선택 (Element Selector)
          </h2>
          <p style={{ margin: "6px 0 0 0", fontSize: "16px", fontWeight: 600, color: "#4B5563" }}>
            각 행에서 가장 부합하는 관점의 시각 요소를 클릭하여 최종 통합 장면안으로 조합하세요.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {CATEGORY_ROWS.map((catRow) => {
            const currentSelected = selectedElementsMap[catRow.key];

            return (
              <div key={catRow.key} style={{ borderTop: "1px solid #E2E8F0", paddingTop: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontWeight: 900, fontSize: "18px", color: "#111827" }}>
                    {catRow.label}
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 700, color: "#64748B" }}>({catRow.sublabel})</span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "14px" }}>
                  {props.recipes.map((recipe) => {
                    const value =
                      catRow.key === "composition"
                        ? recipe.composition
                        : catRow.key === "subjectPresence"
                        ? recipe.subjectPresence
                        : recipe.colorIntent;

                    if (!value) return null;

                    const isChecked =
                      currentSelected?.category === catRow.key &&
                      currentSelected?.sourceRecipeId === recipe.id;

                    return (
                      <label
                        key={recipe.id}
                        onClick={() => handleSelectElement(catRow.key, recipe, value)}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "12px",
                          padding: "16px",
                          borderRadius: "14px",
                          border: isChecked ? "2px solid #2563EB" : "1px solid #CBD5E1",
                          backgroundColor: isChecked ? "#EFF6FF" : "#FFFFFF",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          boxShadow: isChecked ? "0 4px 12px rgba(37,99,235,0.12)" : "0 1px 3px rgba(0,0,0,0.03)",
                        }}
                      >
                        <input
                          type="radio"
                          name={`cat_${catRow.key}`}
                          checked={isChecked}
                          onChange={() => {}}
                          style={{ marginTop: "4px", accentColor: "#2563EB", width: "18px", height: "18px" }}
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ fontSize: "16px", fontWeight: 900, color: "#111827" }}>
                            [{recipe.participantRole === "director" ? "🎬 감독안" : recipe.participantRole === "cinematographer" ? "🎥 촬영안" : "🎨 미술안"}] {value}
                          </div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "#4B5563" }}>
                            제안: {recipe.participantName}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Bottom Sticky Consolidated Plan Formulation Panel */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "2px solid #2563EB",
          borderRadius: "16px",
          padding: "26px",
          boxShadow: "0 6px 20px rgba(37,99,235,0.1)",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "22px", fontWeight: 900, color: "#111827" }}>
              🧩 실시간 통합 장면안 모음 (Consolidated Scene Plan)
            </h3>
            <p style={{ margin: "6px 0 0 0", fontSize: "16px", fontWeight: 600, color: "#4B5563" }}>
              위에서 선택한 시각 요소를 종합하여 다음 합의 단계로 즉시 넘깁니다.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
            <button
              onClick={handleBuildConsolidatedRecipe}
              style={{
                padding: "14px 24px",
                backgroundColor: "#F3F4F6",
                color: "#111827",
                border: "1px solid #CBD5E1",
                borderRadius: "12px",
                fontSize: "15px",
                fontWeight: 900,
                cursor: "pointer",
                minHeight: "48px",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                transition: "background 0.2s",
              }}
            >
              <span>⚡ 선택한 요소로 통합 장면안 생성</span>
            </button>

            <a
              href={`/m/${props.meetingId || "m_01"}/alignment/${props.issueId}/resolve`}
              style={{
                padding: "14px 28px",
                backgroundColor: "#2563EB",
                color: "#FFFFFF",
                borderRadius: "12px",
                fontSize: "16px",
                fontWeight: 900,
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
                minHeight: "48px",
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <span>👉 다음 단계: 합의 및 승인 단계로 이동</span>
              <span>→</span>
            </a>
          </div>
        </div>

        {/* Live Selected List */}
        {Object.keys(selectedElementsMap).length > 0 && (
          <div style={{ backgroundColor: "#F8FAFC", border: "1px solid #CBD5E1", borderRadius: "12px", padding: "18px", fontSize: "15px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontWeight: 900, color: "#111827" }}>📌 현재 선택된 통합 장면 요소:</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              {Object.values(selectedElementsMap).map((el, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #BFDBFE",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    fontWeight: 800,
                    color: "#2563EB",
                    fontSize: "15px",
                  }}
                >
                  • {el.category}: <strong>{el.selectedValue}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {consolidatedRecipe && (
          <div style={{ backgroundColor: "#ECFDF5", border: "2px solid #34D399", borderRadius: "14px", padding: "18px", fontSize: "15px", color: "#047857", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ fontWeight: 900, fontSize: "17px", color: "#065F46" }}>
              🎉 최종 통합 장면안 (v{consolidatedRecipe.version}) 실시간 합성 완료
            </div>
            <p style={{ margin: 0, fontWeight: 700, color: "#047857" }}>
              {consolidatedRecipe.compiledPrompt}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
