import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Web",
  description: "A local-first OpenAI-compatible chat assistant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
