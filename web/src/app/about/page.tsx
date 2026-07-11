import Link from 'next/link'
import { ArrowLeft, Mail, FlaskConical, Scale, ShieldCheck } from 'lucide-react'

export const runtime = 'edge'

export const metadata = {
    title: 'このサービスについて | OwnNews',
    description: 'OwnNewsの運営者情報・コンテンツの取り扱い・お問い合わせ窓口',
}

// 運営者情報・コンテンツポリシー（公開ページ）。
// 著作権法47条の5（省令）が求める「問い合わせ窓口の明示」を兼ねる。
export default function AboutPage() {
    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="border-b border-border">
                <div className="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
                    <span className="text-lg font-bold tracking-tight text-primary">OwnNews</span>
                    <Link href="/" className="text-[13px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                        <ArrowLeft className="w-4 h-4" />トップへ
                    </Link>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-5 py-10 space-y-8">
                <h1 className="text-2xl font-bold tracking-tight">このサービスについて</h1>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <FlaskConical className="w-5 h-5 text-primary" />研究プロジェクトとしての運営
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        OwnNewsは、フィルターバブルの可視化と「情報的健康」の実現をテーマとする
                        <strong className="text-foreground">大学研究室による研究プロジェクト</strong>として運営されています。
                        推薦アルゴリズムをユーザーの側に置き、情報摂取のバランスを本人が把握・制御できる
                        ニュース体験の設計を研究しています。営利を目的としたサービスではありません。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Scale className="w-5 h-5 text-primary" />コンテンツの取り扱い
                    </h2>
                    <ul className="text-[15.5px] leading-relaxed text-muted-foreground space-y-2 list-disc pl-5">
                        <li>
                            本サービスは、ニュース記事の<strong className="text-foreground">所在検索・情報解析サービス</strong>
                            （著作権法第47条の5）として、記事の「見出し・媒体名・日付・ごく短い抜粋・小さなサムネイル」を
                            表示し、<strong className="text-foreground">記事本文は必ず配信元のサイトで読んでいただく</strong>設計です。
                        </li>
                        <li>
                            記事の収集にあたっては、ニュース検索サイト
                            <a href="https://news.ceek.jp/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline"> CEEK.JP NEWS </a>
                            にご協力いただいています。
                        </li>
                        <li>
                            記事に付与している「栄養素」等の指標は、AIによる情報解析（著作権法第30条の4）の結果です。
                            「AIで深掘り」は、外部のAIサービスに記事タイトルとリンクを引き継いで
                            背景解説を求めるボタンです（本文の転載はしません）。
                        </li>
                        <li>
                            各記事の著作権は、それぞれの報道機関・配信元に帰属します。
                        </li>
                        <li>
                            推薦・学習に使っているアルゴリズムは
                            <Link href="/algorithm" className="text-primary hover:underline">「アルゴリズムの開示」</Link>
                            で実装値そのままに公開しています。
                        </li>
                    </ul>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" />報道機関・権利者の方へ
                    </h2>
                    <p className="text-[15.5px] leading-relaxed text-muted-foreground">
                        掲載内容についてのご意見、掲載停止・削除のご依頼は、下記の連絡先までお知らせください。
                        確認のうえ、速やかに対応いたします。
                    </p>
                </section>

                <section className="space-y-3">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <Mail className="w-5 h-5 text-primary" />運営者・お問い合わせ
                    </h2>
                    <div className="bg-card border border-border rounded-xl p-5 text-[15.5px] leading-relaxed">
                        <p className="text-muted-foreground">運営: 荒川研究室（研究プロジェクト）</p>
                        <p className="text-muted-foreground">
                            連絡先: <a href="mailto:yutaka@arakawa-lab.com" className="text-primary hover:underline">yutaka@arakawa-lab.com</a>
                        </p>
                    </div>
                </section>
            </main>

            <footer className="border-t border-border">
                <div className="max-w-3xl mx-auto px-5 py-6 text-[11px] text-muted-foreground">
                    OwnNews — 情報的健康を保つニュースリーダー（研究プロジェクト）
                </div>
            </footer>
        </div>
    )
}
