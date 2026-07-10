import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Scale, SlidersHorizontal, UserCheck, Salad, ExternalLink, ArrowRight } from 'lucide-react'

export const runtime = 'edge'

export const metadata = {
    title: 'OwnNews — 情報的健康を保つニュースリーダー',
    description:
        'ニュースを食事のように。推薦エンジンはあなたの端末で動き、嗜好データはあなたに帰属。推薦の強度を自分で調整でき、情報摂取の栄養バランスを可視化するニュースリーダー。記事収集にはCEEK.JP NEWSにご協力いただいています。',
}

// 未ログイン時のトップページ（ランディング）。ログイン済みならフィードへ。
export default async function WelcomePage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) redirect('/')

    return (
        <div className="min-h-screen bg-background text-foreground">
            {/* ヘッダー */}
            <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-border">
                <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold tracking-tight text-primary">OwnNews</span>
                        <span className="text-[10px] text-muted-foreground hidden sm:inline">情報的健康を保つニュース</span>
                    </div>
                    <Link
                        href="/login"
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium bg-primary text-primary-foreground rounded-lg px-4 py-2 hover:opacity-90 transition-opacity"
                    >
                        Googleでログイン
                    </Link>
                </div>
            </header>

            <main>
                {/* ヒーロー */}
                <section className="max-w-5xl mx-auto px-5 pt-14 pb-10 text-center">
                    <h1 className="text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
                        ニュースを、<span className="text-primary">食事</span>のように。
                    </h1>
                    <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                        OwnNewsは「情報的健康」を保つためのニュースリーダーです。
                        あなたが何をどれだけ読んでいるかを栄養バランスとして可視化し、
                        推薦アルゴリズムの主導権をプラットフォームからあなたの手に取り戻します。
                    </p>
                    <div className="mt-7 flex items-center justify-center gap-3">
                        <Link
                            href="/login"
                            className="inline-flex items-center gap-2 text-[15px] font-semibold bg-primary text-primary-foreground rounded-xl px-6 py-3 hover:opacity-90 transition-opacity shadow-sm"
                        >
                            無料で始める <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>

                    {/* フィードのスクリーンショット */}
                    <div className="mt-12">
                        <div className="rounded-2xl border border-border shadow-lg overflow-hidden bg-card">
                            <Image
                                src="/lp/feed.png"
                                alt="OwnNewsのフィード画面。あなたのバブル（関心に近い話題）と、いろいろなニュース（全ジャンルから均等）の2つのゾーンに分かれ、上部の「視野の広さ」スライダーで推薦の強度を調整できる"
                                width={1360}
                                height={860}
                                priority
                                className="w-full h-auto"
                            />
                        </div>
                        <p className="mt-3 text-[12px] text-muted-foreground">
                            実際のフィード画面 — 「あなたのバブル」と「バブルの外」を常に並べて表示
                        </p>
                    </div>
                </section>

                {/* なぜ作ったのか */}
                <section className="border-y border-border bg-card/50">
                    <div className="max-w-3xl mx-auto px-5 py-14">
                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">なぜOwnNewsを作ったのか</h2>
                        <div className="mt-5 space-y-4 text-[15.5px] sm:text-base leading-relaxed text-muted-foreground">
                            <p>
                                ふつうのニュースアプリでは、推薦アルゴリズムはプラットフォームの側にあります。
                                あなたの閲覧履歴はプラットフォームのものになり、何がどんな理由で表示されているのかを、
                                あなたは知ることも、変えることもできません。
                                気づかないうちに「見たいものだけ」が並ぶ——いわゆる<strong className="text-foreground">フィルターバブル</strong>が、
                                本人の見えないところで作られていきます。
                            </p>
                            <p>
                                OwnNewsは、大学研究室が「情報的健康」をテーマに運営する研究プロジェクトであり、
                                この構図を逆転させる実験です。
                                <strong className="text-foreground">推薦エンジンをユーザーの側に移す</strong>。
                                嗜好の学習も推薦の計算も、あなたのブラウザの中で動きます。
                                閲覧履歴や関心データはあなた個人のアカウントに帰属し、いつでも自分で確認できます。
                                だから推薦の強さも、バブルの外をどれだけ見るかも、プラットフォームではなく
                                <strong className="text-foreground">あなたが決められます</strong>。
                            </p>
                            <p>
                                そしてもうひとつ。偏食が体に悪いように、偏った情報摂取は「情報的健康」を損ないます。
                                OwnNewsは記事に<strong className="text-foreground">栄養素</strong>（事実性・感情度・文脈・即時性）を定義し、
                                あなたの情報摂取のバランスを食事のように可視化します。
                            </p>
                        </div>
                    </div>
                </section>

                {/* 特徴 */}
                <section className="max-w-5xl mx-auto px-5 py-14">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-center">他のニュースサイトとの違い</h2>
                    <div className="mt-8 grid sm:grid-cols-2 gap-4">
                        <div className="bg-card border border-border rounded-2xl p-5">
                            <UserCheck className="w-6 h-6 text-primary" />
                            <h3 className="mt-3 text-[17px] font-bold">嗜好データはあなたに帰属</h3>
                            <p className="mt-1.5 text-[15px] text-muted-foreground leading-relaxed">
                                推薦エンジンはあなたの端末（ブラウザ内）で動作。何を読んだか・何に関心があるかは
                                あなたのアカウントのものとして扱われ、履歴ページでいつでも確認・削除できます。
                                運営側が個人の嗜好を使って表示を操作することはありません。
                            </p>
                        </div>
                        <div className="bg-card border border-border rounded-2xl p-5">
                            <SlidersHorizontal className="w-6 h-6 text-primary" />
                            <h3 className="mt-3 text-[17px] font-bold">推薦の強度を自分で変えられる</h3>
                            <p className="mt-1.5 text-[15px] text-muted-foreground leading-relaxed">
                                「視野の広さ」スライダーで、自分のバブルに浸るか、視野を広げるかをその場で調整。
                                プラットフォームに最適化を委ねるのではなく、アルゴリズムのつまみがあなたの手元にあります。
                            </p>
                        </div>
                        <div className="bg-card border border-border rounded-2xl p-5">
                            <Salad className="w-6 h-6 text-primary" />
                            <h3 className="mt-3 text-[17px] font-bold">情報の栄養バランスを可視化</h3>
                            <p className="mt-1.5 text-[15px] text-muted-foreground leading-relaxed">
                                すべての記事に「栄養素」（事実性・感情度・文脈・即時性）をAIが付与。
                                ダッシュボードで摂取バランス・多様性スコア・足りないジャンルが一目で分かり、
                                偏りがあれば教えてくれます。
                            </p>
                        </div>
                        <div className="bg-card border border-border rounded-2xl p-5">
                            <Scale className="w-6 h-6 text-primary" />
                            <h3 className="mt-3 text-[17px] font-bold">バブルの外が、常に見える</h3>
                            <p className="mt-1.5 text-[15px] text-muted-foreground leading-relaxed">
                                フィードは「あなたのバブル」と「バブルの外」の2ゾーン構成。
                                バブルの外は全ジャンルから均等に選ばれ、関心の外側にある世界が
                                自然と目に入る設計です。
                            </p>
                        </div>
                    </div>

                    {/* ダッシュボードのスクリーンショット */}
                    <div className="mt-12 text-center">
                        <div className="rounded-2xl border border-border shadow-lg overflow-hidden bg-card">
                            <Image
                                src="/lp/dashboard.png"
                                alt="OwnNewsのダッシュボード画面。情報摂取の栄養バランス、多様性スコア、ジャンル分布、閲覧アクティビティなどを可視化"
                                width={1360}
                                height={860}
                                className="w-full h-auto"
                            />
                        </div>
                        <p className="mt-3 text-[12px] text-muted-foreground">
                            実際のダッシュボード — 情報摂取のバランスを食事のようにチェック
                        </p>
                    </div>
                </section>

                {/* ニュースソース */}
                <section className="border-t border-border bg-card/50">
                    <div className="max-w-3xl mx-auto px-5 py-12">
                        <h2 className="text-lg font-bold tracking-tight">ニュースの収集について</h2>
                        <p className="mt-3 text-[15px] text-muted-foreground leading-relaxed">
                            記事の収集にあたっては、国内の報道各社のニュースを横断的にまとめる
                            ニュース検索サイト{' '}
                            <a
                                href="https://news.ceek.jp/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary font-medium hover:underline inline-flex items-center gap-0.5"
                            >
                                CEEK.JP NEWS<ExternalLink className="w-3 h-3" />
                            </a>{' '}
                            にご協力いただいています。政治・経済・国際・社会からスポーツ・IT・サイエンスまで
                            幅広いジャンルをカバーし、OwnNewsは見出しと概要を整理して表示、
                            記事本文は配信元のサイトで読む形式です。
                        </p>
                    </div>
                </section>

                {/* 最後のCTA */}
                <section className="max-w-5xl mx-auto px-5 py-16 text-center">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
                        今日から、情報の食生活を整える。
                    </h2>
                    <p className="mt-3 text-[15px] text-muted-foreground">
                        Googleアカウントでログインするだけ。閲覧するほど、あなたのバブルの形が見えてきます。
                    </p>
                    <Link
                        href="/login"
                        className="mt-6 inline-flex items-center gap-2 text-[15px] font-semibold bg-primary text-primary-foreground rounded-xl px-6 py-3 hover:opacity-90 transition-opacity shadow-sm"
                    >
                        無料で始める <ArrowRight className="w-4 h-4" />
                    </Link>
                </section>
            </main>

            {/* フッター */}
            <footer className="border-t border-border">
                <div className="max-w-5xl mx-auto px-5 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-[12px] text-muted-foreground">
                    <span>
                        OwnNews — 情報的健康を保つニュースリーダー（研究プロジェクト）
                        <a href="/about" className="ml-2 underline hover:text-foreground">運営者情報</a>
                        <a href="/algorithm" className="ml-2 underline hover:text-foreground">アルゴリズムの開示</a>
                    </span>
                    <span>
                        ニュース収集にご協力いただいています:{' '}
                        <a href="https://news.ceek.jp/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline">
                            CEEK.JP NEWS
                        </a>
                    </span>
                </div>
            </footer>
        </div>
    )
}
