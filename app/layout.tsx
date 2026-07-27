import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Web",
  description: "支持多模型提供方、对话分组和流式响应的本地优先 AI 助手。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
