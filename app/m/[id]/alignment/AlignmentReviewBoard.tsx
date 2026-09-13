"use client";

import React, { useState, useEffect } from "react";
import type { AlignmentIssueV2 } from "@/lib/alignment/schema";
import { summarizeAlignmentReview } from "@/lib/analysis/reviewSummary";
import { speakerDisplay } from "@/lib/alignment/present";
import styles from "./comparison.module.css";

export function AlignmentComparison(props: {
  meetingId: string; issue: AlignmentIssueV2;
  utts: Record<string, { uid: string; who: string; text: string }>;
}) {
  const review = summarizeAlignmentReview([props.issue]);
  return <section className={styles.grid} data-testid="alignment-three-column" aria-label="발언·해석·진단 3열 비교">
    <div><h3>1. 실제 발언</h3>{props.issue.evidence_all.map(uid => <blockquote key={uid}>
      <a href={`/m/${props.meetingId}?tab=transcript#u_${uid}`}>{uid}</a> · {props.utts[uid]?.who ?? "근거 없음"}
      <p>{props.utts[uid]?.text ?? "현재 전사에 이 발언이 없습니다."}</p>
    </blockquote>)}</div>
    <div><h3>2. 화자별 해석</h3>{props.issue.positions.map((p, n) => <div key={n}>
      <strong>{speakerDisplay(p.speaker)}</strong><p>{p.meaning}</p>
      <small>근거 {p.evidence.join(", ")} · 문맥 {p.checks.context === "supported" ? "확인" : "확인 필요"}</small>
    </div>)}</div>
    <div><h3>3. 판정 근거·확인 질문</h3>
      <p data-testid="issue-comparison-counts"><strong>다름 {review.different}쌍 / 판정 {review.compared}쌍 / 미판정 {review.unknown}쌍</strong></p>
      <p>판정 커버리지 {review.coverage === null ? "비교 항목 없음" : `${review.coverage}%`}</p>
      <p><strong>{props.issue.question}</strong></p><p>{props.issue.why_it_matters}</p>
      <small>이 안건의 비교 근거를 표시합니다. 회의 전체의 갈등 정도를 뜻하지 않습니다.</small>
      <p><small>시연 대본용 낱말 보조 검사는 일반 탐지기가 아니며, 이 판정 집계에 사용하지 않습니다.</small></p>
    </div>
  </section>;
}

import type { AlignmentFinding, AlignmentIssue, IssueStatus } from "@/lib/domain/alignmentCheck/types";

interface AlignmentReviewBoardProps {
  projectId: string;
  sceneNumber: number;
  initialIssues: AlignmentIssue[];
  initialFindings: AlignmentFinding[];
}

export function AlignmentReviewBoard(props: AlignmentReviewBoardProps) {
  const [issues, setIssues] = useState<AlignmentIssue[]>(props.initialIssues);
  const [findings] = useState<AlignmentFinding[]>(props.initialFindings);
  const [selectedIssueId, setSelectedIssueId] = useState<string>(
    props.initialIssues[0]?.id || "issue_det_1"
  );
  const [directAnswerInputs, setDirectAnswerInputs] = useState<Record<string, string>>({});
  const [activeAnswerForm, setActiveAnswerForm] = useState(false);

  // SQLite 영속화 API 연동
  useEffect(() => {
    props.initialIssues.forEach((issue) => {
      fetch("/api/alignment/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(issue),
      }).catch((err) => console.error("Persist issue error:", err));
    });
  }, [props.initialIssues]);

  const openIssues = issues.filter((i) => i.status !== "resolved" && i.status !== "dismissed");
  const blockingCount = openIssues.filter((i) => i.severity === "blocking").length;
  const currentIssue = issues.find((i) => i.id === selectedIssueId) || issues[0];

  const handleUpdateStatus = (issueId: string, newStatus: IssueStatus) => {
    setIssues((prev) =>
      prev.map((issue) => {
        if (issue.id === issueId) {
          const updated = { ...issue, status: newStatus };
          fetch("/api/alignment/issue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated),
          }).catch((err) => console.error("Update issue error:", err));
          return updated;
        }
        return issue;
      })
    );
    setActiveAnswerForm(false);
  };

  const handleSaveDirectAnswer = (issueId: string) => {
    const answerText = directAnswerInputs[issueId];
    if (!answerText || !answerText.trim()) {
      alert("답변 내용을 입력해 주세요.");
      return;
    }
    handleUpdateStatus(issueId, "resolved");
  };

  const displayTopic = (topic: string, id: string) => {
    if (id === "issue_det_1") return "인물 존재 여부 충돌";
    return topic;
  };

  const displayIssueType = (type: string) => {
    if (type === "conflict") return "⚡ 시각적 해석 충돌";
    if (type === "unconfirmed") return "🧐 미확인 안건";
    return "❓ 시각적 모호함";
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1520px",
        margin: "0 auto",
        padding: "24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, Pretendard, 'Inter', sans-serif",
        color: "#171A1F",
      }}
    >
      {/* 1. Hero Header Banner */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #CBD5E1",
          borderRadius: "16px",
          padding: "24px",
          marginBottom: "24px",
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
            <span>🔍 2단계: 다시 짚기 (Alignment Check)</span>
            <span>•</span>
            <span style={{ color: "#4B5563" }}>SCENE {props.sceneNumber}</span>
          </div>
          <h1 style={{ fontSize: "28px", fontWeight: 900, color: "#111827", margin: 0, letterSpacing: "-0.5px" }}>
            같은 장면을 서로 다르게 이해한 지점이 <span style={{ color: "#2563EB" }}>{openIssues.length}개</span> 발견되었습니다.
          </h1>
          <p style={{ fontSize: "16px", fontWeight: 600, color: "#4B5563", margin: "6px 0 0 0" }}>
            이미지를 만들기 전에 제작진의 시각적 동상이몽(해석 차이)을 먼저 확인하고 하나로 모으세요.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ backgroundColor: "#F8FAFC", padding: "10px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: 800, color: "#374151", border: "1px solid #CBD5E1" }}>
            공통 합의: <strong style={{ color: "#059669" }}>{findings.length}건</strong>
          </div>
          <div
            style={{
              padding: "10px 16px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 900,
              border: blockingCount > 0 ? "2px solid #FB923C" : "1px solid #A7F3D0",
              backgroundColor: blockingCount > 0 ? "#FFF7ED" : "#ECFDF5",
              color: blockingCount > 0 ? "#C2410C" : "#047857",
            }}
          >
            {blockingCount > 0 ? `⚠️ 진행 차단 안건 ${blockingCount}건` : "🟢 차단 안건 없음"}
          </div>
        </div>
      </div>

      {/* 2. Main 2-Column Split Layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "380px 1fr",
          gap: "24px",
          alignItems: "start",
        }}
      >
        {/* Left Column: Issue List Selector Sidebar */}
        <div
          style={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #CBD5E1",
            borderRadius: "16px",
            padding: "20px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 900, color: "#374151" }}>
            📋 다시 확인할 안건 목록 ({issues.length}건)
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {issues.map((issue) => {
              const isSelected = issue.id === selectedIssueId;
              const isResolved = issue.status === "resolved";

              return (
                <button
                  key={issue.id}
                  onClick={() => setSelectedIssueId(issue.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "16px",
                    borderRadius: "12px",
                    border: isSelected ? "2px solid #2563EB" : "1px solid #CBD5E1",
                    backgroundColor: isSelected ? "#EFF6FF" : "#FFFFFF",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    boxShadow: isSelected ? "0 4px 12px rgba(37,99,235,0.12)" : "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 900,
                        color: "#2563EB",
                        backgroundColor: "#FFFFFF",
                        border: "1px solid #BFDBFE",
                        padding: "3px 8px",
                        borderRadius: "6px",
                      }}
                    >
                      {displayIssueType(issue.issueType)}
                    </span>
                    <span style={{ fontSize: "13px", fontWeight: 800, color: isResolved ? "#059669" : issue.severity === "blocking" ? "#E11D48" : "#D97706" }}>
                      {isResolved ? "✅ 해결됨" : issue.severity === "blocking" ? "🔴 차단 안건" : "🟡 권장 안건"}
                    </span>
                  </div>
                  <h4 style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: "#111827" }}>
                    {displayTopic(issue.topic, issue.id)}
                  </h4>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "15px",
                      fontWeight: 600,
                      color: "#4B5563",
                      lineHeight: "1.5",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {issue.summary}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Column: Selected Issue Detailed View Panel */}
        {currentIssue && (
          <div
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #CBD5E1",
              borderRadius: "16px",
              padding: "28px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            {/* Issue Header */}
            <div style={{ borderBottom: "1px solid #E2E8F0", paddingBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: 900,
                    color: "#2563EB",
                    backgroundColor: "#EFF6FF",
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  {displayIssueType(currentIssue.issueType)} 안건 상세
                </span>
                <span style={{ fontSize: "14px", fontWeight: 800, color: "#4B5563" }}>
                  상태: <strong style={{ color: "#111827" }}>{currentIssue.status}</strong>
                </span>
              </div>
              <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 900, color: "#111827", letterSpacing: "-0.5px" }}>
                {displayTopic(currentIssue.topic, currentIssue.id)}
              </h2>
              <p style={{ margin: "10px 0 0 0", fontSize: "17px", fontWeight: 600, color: "#374151", lineHeight: "1.6" }}>
                {currentIssue.summary}
              </p>
            </div>

            {/* Why It Matters */}
            <div
              style={{
                backgroundColor: "#F8FAFC",
                border: "1px solid #CBD5E1",
                borderRadius: "14px",
                padding: "18px",
                fontSize: "15px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div style={{ fontWeight: 900, color: "#2563EB", fontSize: "16px" }}>📌 이 안건이 중요한 이유 (시각 연출 관점)</div>
              <p style={{ margin: 0, fontWeight: 700, color: "#374151", lineHeight: "1.5" }}>
                {currentIssue.whyItMatters}
              </p>
            </div>

            {/* Speaker Positions Cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 900, color: "#111827" }}>
                  💬 제작진별 시각 해석 차이 (발언 대조)
                </h3>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#4B5563" }}>📍 회의 녹화 U-ID 근거 연동</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                {currentIssue.participantPositions.map((pos, idx) => {
                  const roleLabel =
                    pos.participantRole === "director"
                      ? "🎬 감독"
                      : pos.participantRole === "cinematographer"
                      ? "🎥 촬영감독"
                      : pos.participantRole === "production_designer"
                      ? "🎨 미술감독"
                      : "💼 제작PD";

                  const roleBg =
                    pos.participantRole === "director"
                      ? "#EFF6FF"
                      : pos.participantRole === "cinematographer"
                      ? "#FDF2F8"
                      : "#FEFCE8";

                  const roleText =
                    pos.participantRole === "director"
                      ? "#1E40AF"
                      : pos.participantRole === "cinematographer"
                      ? "#9D174D"
                      : "#854D0E";

                  const roleBorder =
                    pos.participantRole === "director"
                      ? "#BFDBFE"
                      : pos.participantRole === "cinematographer"
                      ? "#FBCFE8"
                      : "#FEF08A";

                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid #CBD5E1",
                        borderRadius: "14px",
                        padding: "18px",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "14px",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span
                            style={{
                              fontSize: "13px",
                              fontWeight: 900,
                              padding: "4px 8px",
                              borderRadius: "6px",
                              backgroundColor: roleBg,
                              color: roleText,
                              border: `1px solid ${roleBorder}`,
                            }}
                          >
                            {roleLabel} ({pos.participantName})
                          </span>
                          <span title="회의 녹화 근거 ID" style={{ fontSize: "11px", fontWeight: 600, fontFamily: "monospace", color: "#9CA3AF", backgroundColor: "transparent", padding: "2px 4px", borderRadius: "4px" }}>
                            근거 {pos.evidenceUids.join(", ")}
                          </span>
                        </div>

                        <p style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#111827", lineHeight: "1.5" }}>
                          "{pos.interpretation}"
                        </p>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: 700, color: "#4B5563", borderTop: "1px solid #E2E8F0", paddingTop: "10px" }}>
                        <span>{pos.basis === "explicit" ? "🎙️ 직접 발언" : "🧠 AI 추론"}</span>
                        <span>신뢰도 {Math.round(pos.confidence * 100)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* AI Suggested Question */}
            {currentIssue.suggestedQuestion && (
              <div
                style={{
                  backgroundColor: "#FFF7ED",
                  border: "2px solid #FB923C",
                  borderRadius: "14px",
                  padding: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <span style={{ fontSize: "14px", fontWeight: 900, color: "#C2410C" }}>💡 AI 추천 시각 합의 질문</span>
                <p style={{ margin: 0, fontSize: "17px", fontWeight: 900, color: "#111827" }}>
                  "{currentIssue.suggestedQuestion}"
                </p>
              </div>
            )}

            {/* Inline Answer Form */}
            {activeAnswerForm && (
              <div
                style={{
                  backgroundColor: "#F8FAFC",
                  border: "2px solid #2563EB",
                  borderRadius: "14px",
                  padding: "18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <label style={{ fontSize: "14px", fontWeight: 900, color: "#2563EB" }}>
                  ✏️ 제작진 직접 답변 및 합의 작성
                </label>
                <textarea
                  value={directAnswerInputs[currentIssue.id] || ""}
                  onChange={(e) =>
                    setDirectAnswerInputs({ ...directAnswerInputs, [currentIssue.id]: e.target.value })
                  }
                  placeholder="예: 35mm 와이드 샷을 기본 구도로 하되, 수영장의 적막함을 위해 인물 위치를 중앙에서 우측으로 옮깁니다."
                  style={{
                    width: "100%",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #CBD5E1",
                    borderRadius: "8px",
                    padding: "12px",
                    fontSize: "15px",
                    fontWeight: 600,
                    color: "#111827",
                    minHeight: "90px",
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                  <button
                    onClick={() => setActiveAnswerForm(false)}
                    style={{ padding: "10px 18px", backgroundColor: "#FFFFFF", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontWeight: 800, color: "#4B5563", cursor: "pointer" }}
                  >
                    취소
                  </button>
                  <button
                    onClick={() => handleSaveDirectAnswer(currentIssue.id)}
                    style={{ padding: "10px 22px", backgroundColor: "#2563EB", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 900, color: "#FFFFFF", cursor: "pointer", minHeight: "44px" }}
                  >
                    답변 저장 & 해결 확정
                  </button>
                </div>
              </div>
            )}

            {/* Action Bar (Min 44px height primary CTA) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #E2E8F0", paddingTop: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={() => setActiveAnswerForm((v) => !v)}
                  style={{
                    padding: "10px 18px",
                    backgroundColor: "#F3F4F6",
                    border: "1px solid #CBD5E1",
                    borderRadius: "10px",
                    fontSize: "14px",
                    fontWeight: 800,
                    color: "#374151",
                    cursor: "pointer",
                    minHeight: "44px",
                  }}
                >
                  ✏️ 직접 답변 작성
                </button>
                <button
                  onClick={() => handleUpdateStatus(currentIssue.id, "dismissed")}
                  style={{
                    padding: "10px 16px",
                    backgroundColor: "transparent",
                    border: "none",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#64748B",
                    cursor: "pointer",
                    minHeight: "44px",
                  }}
                >
                  🚫 문제 아님 (Dismiss)
                </button>
              </div>

              {/* PRIMARY CTA - NAVIGATES TO COMPARISON BOARD */}
              <a
                href={`/m/${currentIssue.meetingId || "m_01"}/alignment/${currentIssue.id}/compare`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "14px 28px",
                  backgroundColor: "#2563EB",
                  color: "#FFFFFF",
                  fontWeight: 900,
                  fontSize: "16px",
                  borderRadius: "12px",
                  textDecoration: "none",
                  boxShadow: "0 4px 14px rgba(37,99,235,0.3)",
                  minHeight: "48px",
                  transition: "background 0.2s",
                }}
              >
                <span>👉 다음 단계: 3열 관점 비교 Board로 이동</span>
                <span>→</span>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
