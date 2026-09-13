"use client";

import React, { useState } from "react";

interface DemoSessionDisclaimerProps {
  message?: string;
}

export function DemoSessionDisclaimer(props: DemoSessionDisclaimerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ width: "100%", maxWidth: "1360px", margin: "16px auto 0 auto", padding: "0 24px", fontFamily: "-apple-system, BlinkMacSystemFont, Pretendard, sans-serif" }}>
      <div
        style={{
          backgroundColor: "#FFF7ED",
          border: "1px solid #FED7AA",
          borderRadius: "12px",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "13px",
          color: "#C2410C",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 800, fontSize: "14px" }}>💡</span>
          <span style={{ fontWeight: 700 }}>
            {props.message || "현재 데모는 임시 세션으로 실행 중입니다. 새로고침하면 입력 내용이 초기화됩니다."}
          </span>
        </div>

        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              fontSize: "11px",
              fontWeight: 800,
              color: "#C2410C",
              backgroundColor: "transparent",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {expanded ? "접기 ▲" : "연결 설정 보기 ▼"}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            marginTop: "8px",
            backgroundColor: "#F1F2F4",
            border: "1px solid #E2E8F0",
            borderRadius: "12px",
            padding: "12px 16px",
            fontSize: "12px",
            color: "#5F6672",
            fontFamily: "monospace",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          <div>• Storage mode: In-Memory / Local Session</div>
          <div>• Database Status: SQLite persistent API fallback active</div>
          <div>• Image Strategy: Contract Payload Preview Strategy</div>
        </div>
      )}
    </div>
  );
}
