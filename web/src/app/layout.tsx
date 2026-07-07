import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OwnNews | 情報的健康を保つニュースフィード",
  description: "ニュースを食事になぞらえ、情報摂取のバランスを可視化するローカルファースト・ニュースリーダー。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F7F7F5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${inter.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: `var(--font-inter), "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", sans-serif` }}
      >
        {children}
        <Toaster position="bottom-center" />
      </body>
    </html>
  );
}
