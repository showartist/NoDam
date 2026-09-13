"use client";

export default function PrintButton() {
  return (
    <button className="small primary" onClick={() => window.print()}>
      🖨 인쇄 · PDF 저장
    </button>
  );
}
