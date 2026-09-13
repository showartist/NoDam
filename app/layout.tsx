import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "동상이몽",
  description: "영화 기획·프리프로덕션 회의 발화를 Scene Brief, Shot Board, Previs, Department Handoff로 연결합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
