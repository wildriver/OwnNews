import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const SITE_URL = "https://ownnews-web.pages.dev";
const SITE_NAME = "OwnNews";
const SITE_TITLE = "OwnNews | 情報的健康を保つニュースフィード";
const SITE_DESC =
  "ニュースを食事になぞらえ、情報摂取のバランスを可視化するローカルファースト・ニュースリーダー。";

export const metadata: Metadata = {
  // 相対パス（/ogp.png 等）を絶対URLに解決するために必要。
  // これが無いとSNS側が画像を取得できずカードが出ない。
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESC,
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "OwnNews", statusBarStyle: "default" },
  // SNS共有時のカード（画像は scripts/gen_ogp.py で生成）
  openGraph: {
    type: "website",
    locale: "ja_JP",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [{ url: "/ogp.png", width: 1200, height: 630, alt: SITE_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ["/ogp.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F7F7F5",
  // iPhoneのホームインジケータ領域を検知するために必須（env(safe-area-inset-*)が有効になる）
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // 描画前スクリプトが data-textsize を付与するためハイドレーション差分を許容
    <html lang="ja" suppressHydrationWarning>
      <head>
        {/* 描画前に保存済みの表示サイズを適用してちらつきを防ぐ */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var s=localStorage.getItem('ownnews_textsize');if(s)document.documentElement.dataset.textsize=s;}catch(e){}`,
          }}
        />
      </head>
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
