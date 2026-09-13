"use client";

import React, { useState } from "react";

export type StepperStep = "transcript" | "review" | "compare" | "resolve" | "production";

interface HeaderNavStepperProps {
  projectId: string;
  meetingId: string;
  issueId?: string;
  currentStep: StepperStep;
  sceneNumber?: number;
  slugline?: string;
  oneLiner?: string;
}

const STEP_DEFINITIONS: { id: StepperStep; label: string; sublabel: string; getHref: (mId: string, iId?: string) => string }[] = [
  {
    id: "transcript",
    label: "1. 회의 기록",
    sublabel: "Meeting Log",
    getHref: (mId) => `/m/${mId}?tab=transcript`,
  },
  {
    id: "review",
    label: "2. 다시 짚기",
    sublabel: "Alignment Check",
    getHref: (mId) => `/m/${mId}/alignment`,
  },
  {
    id: "compare",
    label: "3. 관점 비교",
    sublabel: "Comparison",
    getHref: (mId, iId) => (iId ? `/m/${mId}/alignment/${iId}/compare` : `/m/${mId}/alignment`),
  },
  {
    id: "resolve",
    label: "4. 합의",
    sublabel: "Resolution",
    getHref: (mId, iId) => (iId ? `/m/${mId}/alignment/${iId}/resolve` : `/m/${mId}/alignment`),
  },
  {
    id: "production",
    label: "5. 최종 제작안",
    sublabel: "Production Blueprint",
    getHref: (mId) => `/m/${mId}?tab=shotboard`,
  },
];

export function HeaderNavStepper(props: HeaderNavStepperProps) {
  const [showDataDrawer, setShowDataDrawer] = useState(false);
  const activeIndex = STEP_DEFINITIONS.findIndex((s) => s.id === props.currentStep);

  return (
    <header
      style={{
        width: "100%",
        backgroundColor: "#FFFFFF",
        borderBottom: "1px solid #E2E8F0",
        position: "sticky",
        top: 0,
        zIndex: 50,
        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        fontFamily: "-apple-system, BlinkMacSystemFont, Pretendard, 'Inter', sans-serif",
      }}
    >
      {/* 1. Global Brand Header */}
      <div
        style={{
          maxWidth: "1520px",
          margin: "0 auto",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        {/* Left: Brand & Single Line Scene Info */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <a
            href={`/m/${props.meetingId}`}
            style={{ display: "flex", alignItems: "center", gap: "8px", textDecoration: "none" }}
          >
            <span
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                backgroundColor: "#2563EB",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: "14px",
              }}
            >
              동
            </span>
            <span style={{ fontWeight: 900, fontSize: "16px", letterSpacing: "-0.5px", color: "#171A1F" }}>
              동상이몽
            </span>
          </a>

          <div style={{ height: "16px", width: "1px", backgroundColor: "#E2E8F0" }} />

          {/* Single Line Scene Metadata */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
            {/* 장면 정보가 없으면 비워 둔다. 다른 장면(SCENE 34) 값으로 채우지 않는다. */}
            {props.sceneNumber != null && (
              <span
                style={{
                  fontWeight: 800,
                  color: "#2563EB",
                  backgroundColor: "#EFF6FF",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "1px solid #BFDBFE",
                  fontSize: "11px",
                }}
              >
                SCENE {props.sceneNumber}
              </span>
            )}
            {props.slugline && <span style={{ fontWeight: 800, color: "#171A1F" }}>{props.slugline}</span>}
            {props.oneLiner && (
              <>
                <span style={{ color: "#8A919D" }}>•</span>
                <span
                  style={{
                    color: "#5F6672",
                    fontSize: "12px",
                    maxWidth: "360px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  "{props.oneLiner}"
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: Scene Navigation & Secondary Data Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap:"wrap", maxWidth:"100%", whiteSpace:"nowrap" }}>
          <a href={`/m/${props.meetingId}/decisions`} style={{padding:"7px 12px",borderRadius:8,background:"#eff4ff",color:"#245fc8",fontSize:12,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>함께 결정</a>
          <a href={`/m/${props.meetingId}/live`} style={{padding:"7px 12px",borderRadius:8,background:"#2563eb",color:"white",fontSize:12,fontWeight:700,textDecoration:"none",whiteSpace:"nowrap"}}>실시간 회의</a>
          {/* Deemphasized Secondary Control for Presentation Flow */}
          <a
            href={`/m/${props.meetingId}/project-visual`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#4B5563",
              backgroundColor: "#F3F4F6",
              borderRadius: "8px",
              border: "1px solid #E5E7EB",
              textDecoration: "none",
            }}
          >
            <span>🏛️ 작품 바이블</span>
          </a>

          {/* 장면 자료 Dropdown Trigger */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowDataDrawer((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 700,
                color: "#5F6672",
                backgroundColor: "#F1F2F4",
                borderRadius: "8px",
                border: "1px solid #E2E8F0",
                cursor: "pointer",
              }}
            >
              <span>📁 장면 자료</span>
              <span style={{ fontSize: "9px", color: "#8A919D" }}>▼</span>
            </button>

            {/* Dropdown Menu */}
            {showDataDrawer && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  marginTop: "8px",
                  width: "220px",
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: "12px",
                  boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                  padding: "8px 0",
                  zIndex: 100,
                  fontSize: "12px",
                }}
              >
                <div style={{ padding: "6px 12px", fontWeight: 800, color: "#8A919D", borderBottom: "1px solid #F1F2F4" }}>
                  장면 세부 자료 바로가기
                </div>
                <a
                  href={`/m/${props.meetingId}?tab=brief`}
                  style={{ display: "block", padding: "8px 12px", color: "#171A1F", textDecoration: "none" }}
                  onClick={() => setShowDataDrawer(false)}
                >
                  📋 장면 명세 (Brief)
                </a>
                <a
                  href={`/m/${props.meetingId}?tab=shotboard`}
                  style={{ display: "block", padding: "8px 12px", color: "#171A1F", textDecoration: "none" }}
                  onClick={() => setShowDataDrawer(false)}
                >
                  🎬 콘티 스토리보드 (Shotboard)
                </a>
                <a
                  href={`/m/${props.meetingId}?tab=previs`}
                  style={{ display: "block", padding: "8px 12px", color: "#171A1F", textDecoration: "none" }}
                  onClick={() => setShowDataDrawer(false)}
                >
                  🎥 프리비즈 시뮬레이션 (Previs)
                </a>
                <a
                  href={`/m/${props.meetingId}?tab=transcript`}
                  style={{ display: "block", padding: "8px 12px", color: "#171A1F", textDecoration: "none" }}
                  onClick={() => setShowDataDrawer(false)}
                >
                  💬 회의 전사 원문 (Transcript)
                </a>
                <a
                  href={`/m/${props.meetingId}?tab=project_visual_workspace`}
                  style={{ display: "block", padding: "8px 12px", color: "#171A1F", textDecoration: "none", borderTop: "1px solid #F1F2F4" }}
                  onClick={() => setShowDataDrawer(false)}
                >
                  🏛️ 작품 바이블 (Visual Workspace)
                </a>
              </div>
            )}
          </div>

          {/* Scene Select Dropdown (Deemphasized) */}
          <select
            value={props.meetingId}
            onChange={(e) => { window.location.href = `/m/${e.target.value}`; }}
            style={{
              padding: "5px 12px",
              fontSize: "12px",
              fontWeight: 600,
              color: "#4B5563",
              backgroundColor: "#F3F4F6",
              border: "1px solid #E5E7EB",
              borderRadius: "8px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {/*
              lib/seed.ts 가 실제로 시드하는 회의만 넣는다.
                m_01 = SCENE 34 실내 수영장 (발표 시연)
                m_02 = SCENE 12 모텔방      (비교용 보조)
              m_03 은 시드된 적이 없어 고르면 404 였고, m_02 는 "SCENE 13 (복도)" 라는
              존재하지 않는 장면으로 잘못 적혀 있었다.
            */}
            {!(["m_01", "m_02"].includes(props.meetingId)) && <option value={props.meetingId}>현재 회의</option>}
            <option value="m_01">SCENE 34 (실내 수영장)</option>
            <option value="m_02">SCENE 12 (모텔방)</option>
          </select>
        </div>
      </div>

      {/* 2. 5-Step Progress Stepper Navigation */}
      <div style={{ backgroundColor: "#F7F7F5", borderTop: "1px solid #E2E8F0" }}>
        <div style={{ maxWidth: "1520px", margin: "0 auto", padding: "10px 24px" }}>
          <nav style={{ display: "flex", alignItems: "center", gap: "10px", overflowX: "auto" }}>
            {STEP_DEFINITIONS.map((step, idx) => {
              const isCurrent = step.id === props.currentStep;
              const isPassed = idx < activeIndex;

              return (
                <React.Fragment key={step.id}>
                  {idx > 0 && (
                    <span style={{ color: "#9CA3AF", fontSize: "14px", fontWeight: 700, padding: "0 2px" }}>→</span>
                  )}
                  <a
                    href={step.getHref(props.meetingId, props.issueId)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 16px",
                      borderRadius: "10px",
                      fontSize: isCurrent ? "15px" : "14px",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      transition: "all 0.2s",
                      backgroundColor: isCurrent ? "#2563EB" : isPassed ? "#FFFFFF" : "#F3F4F6",
                      color: isCurrent ? "#FFFFFF" : isPassed ? "#111827" : "#4B5563",
                      fontWeight: isCurrent ? 900 : isPassed ? 800 : 700,
                      border: isCurrent ? "2px solid #1D4ED8" : "1px solid #D1D5DB",
                      boxShadow: isCurrent ? "0 4px 12px rgba(37,99,235,0.3)" : "0 1px 2px rgba(0,0,0,0.05)",
                    }}
                  >
                    <span
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "12px",
                        fontWeight: 900,
                        backgroundColor: isCurrent ? "#FFFFFF" : isPassed ? "#10B981" : "#D1D5DB",
                        color: isCurrent ? "#2563EB" : isPassed ? "#FFFFFF" : "#374151",
                        border: isPassed ? "1px solid #059669" : "none",
                      }}
                    >
                      {isPassed ? "✓" : idx + 1}
                    </span>
                    <span>{step.label.replace(/^\d+\.\s*/, "")}</span>
                  </a>
                </React.Fragment>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
