"use client";

import React, { useState } from "react";
import type {
  ConsolidatedExplorationRecipe,
  SelectedVisualElement,
} from "@/lib/domain/explorationRecipe/types";
import type { FinalResolutionAnswer, ResolvedDecision } from "@/lib/domain/resolvedDecision/types";
import { checkResolutionReadiness } from "@/lib/domain/resolvedDecision/readiness";
import { createResolvedDecision, confirmResolvedDecision } from "@/lib/domain/resolvedDecision/builder";
import {
  buildProductionImageRecipe,
  buildProductionGenerationRequestPreview,
} from "@/lib/domain/productionRecipe/builder";
import type { ProductionGenerationRequest, ProductionImageRecipe } from "@/lib/domain/productionRecipe/types";

interface ResolutionBoardViewProps {
  projectId: string;
  meetingId?: string;
  issueId: string;
  consolidatedRecipe: ConsolidatedExplorationRecipe;
}

export function ResolutionBoardView(props: ResolutionBoardViewProps) {
  const [finalAnswers, setFinalAnswers] = useState<FinalResolutionAnswer[]>([]);
  const [directInputText, setDirectInputText] = useState("");
  const [selectedField, setSelectedField] = useState(
    props.consolidatedRecipe.unresolvedFields[0] || "subjectAction"
  );
  const [confirmedByInput, setConfirmedByInput] = useState("한지우(감독)");

  const [decision, setDecision] = useState<ResolvedDecision | null>(null);
  const [prodRecipe, setProdRecipe] = useState<ProductionImageRecipe | null>(null);
  const [requestPreview, setRequestPreview] = useState<ProductionGenerationRequest | null>(null);
  const [showTechSettings, setShowTechSettings] = useState(false);

  const readiness = checkResolutionReadiness(props.consolidatedRecipe, finalAnswers);

  const handleAddDirectAnswer = () => {
    if (!directInputText || !directInputText.trim()) return;

    const newAnswer: FinalResolutionAnswer = {
      field: selectedField,
      value: directInputText.trim(),
      answerType: "direct_answer",
      answeredBy: confirmedByInput,
      answeredAt: new Date().toISOString(),
      evidenceUids: props.consolidatedRecipe.evidenceUids,
    };

    setFinalAnswers([...finalAnswers.filter((a) => a.field !== selectedField), newAnswer]);
    setDirectInputText("");
  };

  const handleUseAiSuggestion = (field: string, aiValue: string) => {
    const newAnswer: FinalResolutionAnswer = {
      field,
      value: aiValue,
      answerType: "direct_answer",
      answeredBy: "AI 제안 채택",
      answeredAt: new Date().toISOString(),
      evidenceUids: props.consolidatedRecipe.evidenceUids,
    };
    setFinalAnswers([...finalAnswers.filter((a) => a.field !== field), newAnswer]);
  };

  const handleDraftDecision = () => {
    const draft = createResolvedDecision(
      props.projectId,
      "m_01",
      ["12"],
      [props.issueId],
      props.consolidatedRecipe,
      finalAnswers,
      confirmedByInput,
      1
    );
    setDecision(draft);
  };

  const handleHumanConfirm = () => {
    if (!decision) {
      handleDraftDecision();
      return;
    }

    try {
      const confirmed = confirmResolvedDecision(decision, props.consolidatedRecipe, confirmedByInput);
      setDecision(confirmed);

      // Build Production Image Recipe & Request Preview
      const prod = buildProductionImageRecipe(confirmed, confirmedByInput);
      const req = buildProductionGenerationRequestPreview(prod);

      // Persist via API
      fetch("/api/alignment/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: confirmed, productionRecipe: prod }),
      }).catch((err) => console.error("Persist resolution error:", err));

      setProdRecipe(prod);
      setRequestPreview(req);
    } catch (err: any) {
      alert(err.message || "합의 확정 중 오류가 발생했습니다.");
    }
  };

  const FIELD_TRANSLATIONS: Record<string, { label: string; question: string; defaultAi: string }> = {
    subjectAction: {
      label: "인물 행동 및 카메라 동선",
      question: "장면 속 인물 행동과 카메라 동선을 어떻게 확정할까요?",
      defaultAi: "수영장 물가 부근에서 정적으로 서서 대사 전달",
    },
    lightingIntent: {
      label: "조명 및 인물 톤앤매너",
      question: "조명 방향과 톤앤매너를 어느 쪽으로 확정할까요?",
      defaultAi: "옆에서 들어오는 차가운 청록빛과 타일 반사 강조",
    },
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1360px",
        margin: "0 auto",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, Pretendard, 'Inter', sans-serif",
        color: "#171A1F",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      {/* 1. Header Banner */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 800, color: "#2563EB", marginBottom: "4px" }}>
            <span>🤝 합의 확정 (Resolution & Agreement)</span>
            <span>•</span>
            <span style={{ color: "#5F6672" }}>안건 {props.issueId}</span>
          </div>
          <h1 style={{ fontSize: "24px", fontWeight: 900, color: "#171A1F", margin: 0, letterSpacing: "-0.5px" }}>
            하나의 장면으로 합의하기
          </h1>
          <p style={{ fontSize: "14px", color: "#5F6672", margin: "4px 0 0 0" }}>
            선택한 시각 요소와 미해결 항목 답변을 결합하여 공식 확정안을 작성합니다.
          </p>
        </div>

        <div
          style={{
            padding: "8px 16px",
            borderRadius: "12px",
            fontSize: "13px",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            border: readiness.status === "ready" ? "1px solid #A7F3D0" : "1px solid #FED7AA",
            backgroundColor: readiness.status === "ready" ? "#ECFDF5" : "#FFF7ED",
            color: readiness.status === "ready" ? "#047857" : "#C2410C",
          }}
        >
          <span>합의 준비 상태:</span>
          <span style={{ fontSize: "15px", fontWeight: 900 }}>
            {readiness.status === "ready" ? "🟢 확정 가능" : "🟡 답변 필요"}
          </span>
        </div>
      </div>

      {/* 2. Top 2-Column Split: Selected Elements (Left) & Unresolved Question Form (Right) */}
      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: "24px", alignItems: "start" }}>
        {/* Left Column: Selected Visual Elements Summary */}
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: "16px",
            padding: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 900, color: "#171A1F" }}>
              🧩 선택된 시각 요소 요약
            </h3>
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#5F6672" }}>
              관점 비교 단계에서 선택된 핵심 파라미터입니다.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {props.consolidatedRecipe.selectedVisualElements.map((el, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: "#F8FAFC",
                  border: "1px solid #E2E8F0",
                  borderRadius: "12px",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800 }}>
                  <span style={{ color: "#2563EB" }}>
                    [{el.sourceParticipantRole === "director" ? "감독" : el.sourceParticipantRole === "cinematographer" ? "촬영" : "미술"}] {el.category}
                  </span>
                  <span style={{ color: "#8A919D", fontFamily: "monospace", fontSize: "11px" }}>
                    {el.evidenceUids.join(", ")}
                  </span>
                </div>
                <div style={{ fontWeight: 900, color: "#171A1F", fontSize: "14px" }}>
                  {el.selectedValue}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Unresolved Question Form */}
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: "16px",
            padding: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 900, color: "#171A1F", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>✏️ 미해결 항목 질문 & 답변 작성</span>
              {readiness.unresolvedFields.length > 0 && (
                <span style={{ fontSize: "12px", fontWeight: 800, color: "#C2410C", backgroundColor: "#FFF7ED", padding: "2px 8px", borderRadius: "6px", border: "1px solid #FED7AA" }}>
                  남은 항목 {readiness.unresolvedFields.length}개
                </span>
              )}
            </h3>
            <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#5F6672" }}>
              확정안 생성을 위해 아래 질문에 답변해 주세요.
            </p>
          </div>

          {readiness.unresolvedFields.length === 0 ? (
            <div style={{ backgroundColor: "#ECFDF5", border: "1px solid #A7F3D0", color: "#047857", padding: "16px", borderRadius: "12px", fontSize: "13px", fontWeight: 900, display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🟢 모든 미해결 항목에 대한 답변이 완료되었습니다!</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {readiness.unresolvedFields.map((fieldKey) => {
                const info = FIELD_TRANSLATIONS[fieldKey] || {
                  label: fieldKey,
                  question: `${fieldKey} 항목을 어떻게 확정할까요?`,
                  defaultAi: "기본 세팅값 적용",
                };

                return (
                  <div
                    key={fieldKey}
                    style={{
                      backgroundColor: "#F8FAFC",
                      border: "1px solid #E2E8F0",
                      borderRadius: "12px",
                      padding: "16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: "#2563EB" }}>
                        {info.label}
                      </span>
                      <h4 style={{ margin: "4px 0 0 0", fontSize: "15px", fontWeight: 900, color: "#171A1F" }}>
                        "{info.question}"
                      </h4>
                    </div>

                    {/* AI Suggestion Box */}
                    <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #BFDBFE", borderRadius: "8px", padding: "12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "13px" }}>
                      <div>
                        <span style={{ fontWeight: 800, color: "#2563EB", backgroundColor: "#EFF6FF", padding: "2px 6px", borderRadius: "4px", marginRight: "6px" }}>
                          AI 제안
                        </span>
                        <span style={{ color: "#171A1F", fontWeight: 600 }}>{info.defaultAi}</span>
                      </div>
                      <button
                        onClick={() => handleUseAiSuggestion(fieldKey, info.defaultAi)}
                        style={{ padding: "6px 12px", backgroundColor: "#2563EB", color: "#FFFFFF", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}
                      >
                        사용하기
                      </button>
                    </div>

                    {/* Direct Input Field */}
                    <div style={{ display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={selectedField === fieldKey ? directInputText : ""}
                        onChange={(e) => {
                          setSelectedField(fieldKey);
                          setDirectInputText(e.target.value);
                        }}
                        placeholder="직접 답변을 입력하세요..."
                        style={{
                          flex: 1,
                          backgroundColor: "#FFFFFF",
                          border: "1px solid #CBD5E1",
                          borderRadius: "8px",
                          padding: "8px 12px",
                          fontSize: "13px",
                          color: "#171A1F",
                          outline: "none",
                        }}
                      />
                      <button
                        onClick={() => {
                          setSelectedField(fieldKey);
                          handleAddDirectAnswer();
                        }}
                        style={{ padding: "8px 16px", backgroundColor: "#171A1F", color: "#FFFFFF", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 800, cursor: "pointer" }}
                      >
                        답변 추가
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Answered List */}
          {finalAnswers.length > 0 && (
            <div style={{ backgroundColor: "#F7F7F5", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "14px", fontSize: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontWeight: 800, color: "#171A1F" }}>추가된 답변 내역:</span>
              <ul style={{ margin: 0, paddingLeft: "16px", color: "#5F6672" }}>
                {finalAnswers.map((a, idx) => (
                  <li key={idx}>
                    <strong>{FIELD_TRANSLATIONS[a.field]?.label || a.field}:</strong> {a.value} ({a.answeredBy})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 3. Bottom Decision Hero & Human Confirmation Panel */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #E2E8F0", paddingBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 900, color: "#171A1F" }}>
              📜 최종 장면 제작 결정문 (Resolved Decision)
            </h3>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#5F6672" }}>
              인간 합의 확정을 거쳐 공식 프리프로덕션 제작안으로 승급합니다.
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", fontWeight: 800, color: "#5F6672" }}>결정권자:</span>
            <input
              type="text"
              value={confirmedByInput}
              onChange={(e) => setConfirmedByInput(e.target.value)}
              style={{ backgroundColor: "#F8FAFC", border: "1px solid #CBD5E1", borderRadius: "8px", padding: "6px 12px", fontSize: "13px", fontWeight: 800, color: "#171A1F", width: "140px", outline: "none" }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <a
            href={`/m/${props.meetingId || "m_01"}/alignment/${props.issueId}/compare`}
            style={{ fontSize: "13px", fontWeight: 800, color: "#5F6672", textDecoration: "none" }}
          >
            ← 관점 비교로 돌아가기
          </a>

          <div>
            <button
              onClick={handleHumanConfirm}
              disabled={readiness.status !== "ready"}
              style={{
                padding: "14px 32px",
                borderRadius: "12px",
                fontSize: "16px",
                fontWeight: 900,
                border: "none",
                cursor: readiness.status === "ready" ? "pointer" : "not-allowed",
                backgroundColor: readiness.status === "ready" ? "#2563EB" : "#E2E8F0",
                color: readiness.status === "ready" ? "#FFFFFF" : "#8A919D",
                boxShadow: readiness.status === "ready" ? "0 4px 14px rgba(37,99,235,0.3)" : "none",
                minHeight: "48px",
              }}
            >
              이 장면으로 합의 확정 🤝
            </button>

            <a
              href={`/m/${props.meetingId || "m_01"}?tab=shotboard`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                padding: "14px 28px",
                backgroundColor: "#059669",
                color: "#FFFFFF",
                fontWeight: 900,
                fontSize: "16px",
                borderRadius: "12px",
                textDecoration: "none",
                boxShadow: "0 4px 14px rgba(5,150,105,0.3)",
                minHeight: "48px",
                transition: "background 0.2s",
              }}
            >
              <span>👉 5단계: 최종 제작안 (Scene Bible) 확인하기</span>
              <span>→</span>
            </a>
          </div>
        </div>

        {readiness.status !== "ready" && (
          <div style={{ backgroundColor: "#FFF7ED", border: "1px solid #FED7AA", color: "#C2410C", padding: "14px", borderRadius: "12px", fontSize: "15px", fontWeight: 800 }}>
            ⚠️ 남은 미해결 항목 {readiness.unresolvedFields.length}개를 작성해야 합의 확정이 가능합니다. (발표 진행을 위해 5단계 버튼을 클릭하여 바로 이동하실 수 있습니다)
          </div>
        )}

        {/* Confirmed Decision Display & Production Recipe Preview */}
        {decision && decision.status === "confirmed" && (
          <div style={{ backgroundColor: "#ECFDF5", border: "2px solid #34D399", borderRadius: "16px", padding: "26px", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <h4 style={{ margin: 0, fontWeight: 900, fontSize: "20px", color: "#065F46" }}>
                🎉 최종 합의 확정 (Resolved Decision v{decision.version})
              </h4>
              <a
                href={`/m/${props.meetingId || "m_01"}?tab=shotboard`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px 24px",
                  backgroundColor: "#059669",
                  color: "#FFFFFF",
                  fontWeight: 900,
                  fontSize: "16px",
                  borderRadius: "10px",
                  textDecoration: "none",
                  boxShadow: "0 4px 12px rgba(5,150,105,0.25)",
                }}
              >
                <span>👉 최종 제작안 보러가기</span>
                <span>→</span>
              </a>
            </div>

            {/* AI Visualized Production Concept Image */}
            <div style={{ position: "relative", width: "100%", height: "320px", borderRadius: "14px", overflow: "hidden", border: "2px solid #34D399", boxShadow: "0 6px 16px rgba(5, 150, 105, 0.2)", backgroundColor: "#047857" }}>
              <img
                src="/images/pool_final_resolution.png"
                alt="최종 승인 제작안 AI 시각화 레퍼런스"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 22px", background: "linear-gradient(transparent, rgba(0,0,0,0.85))", color: "#FFFFFF", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                <span style={{ fontSize: "17px", fontWeight: 900, letterSpacing: "-0.3px" }}>🎬 최종 합의 제작안 AI 시각화 렌더링 (Scene Bible V1)</span>
                <span style={{ backgroundColor: "#10B981", color: "#FFFFFF", fontSize: "14px", fontWeight: 900, padding: "5px 12px", borderRadius: "8px", boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>APPROVED ✓</span>
              </div>
            </div>

            <div style={{ backgroundColor: "#FFFFFF", border: "1px solid #A7F3D0", borderRadius: "12px", padding: "18px", fontSize: "17px", fontWeight: 800, color: "#111827", lineHeight: "1.6" }}>
              "{decision.decisionSummary}"
            </div>

            <div style={{ fontSize: "14px", fontWeight: 700, color: "#065F46", display: "flex", gap: "18px", flexWrap: "wrap" }}>
              <span>✅ 확정자: {decision.resolvedBy}</span>
              <span>🕒 확정시각: {decision.resolvedAt}</span>
              <span>📌 근거 U-ID: {decision.evidenceUids.join(", ")}</span>
            </div>

            {/* Production Settings Drawer */}
            <div>
              <button
                onClick={() => setShowTechSettings((v) => !v)}
                style={{ fontSize: "14px", fontWeight: 800, color: "#047857", backgroundColor: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
              >
                {showTechSettings ? "⚙️ AI 생성 설정 접기 ▲" : "⚙️ AI 생성 설정 보기 ▼"}
              </button>

              {showTechSettings && requestPreview && (
                <div style={{ marginTop: "10px", backgroundColor: "#FFFFFF", border: "1px solid #A7F3D0", borderRadius: "12px", padding: "16px", fontSize: "13px", fontFamily: "monospace", color: "#374151", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div>[상태]: AI 이미지 생성 서비스 미연결 (발표 프리뷰 모드)</div>
                  <div>[레시피 ID]: {requestPreview.productionRecipeId}</div>
                  <div>[AI 모델]: {requestPreview.provider} ({requestPreview.model})</div>
                  <div>[생성 프롬프트]: {requestPreview.promptPayload}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
