'use client'

// 記事詳細（ローカルファースト）
// 記事本体は端末内の記事パック（IndexedDB）から即表示。関連記事の類似度計算も
// 端末内の埋め込みで行うため、サーバー往復ゼロ＝高速。
// キャッシュに無い記事（直リンク等）だけ /api/article/[id] で軽量フォールバック取得する。

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Calendar, Tag, Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SafeImage } from '@/components/safe-image'
import { ClientNutrientRadar } from '@/components/client-nutrient-radar'
import { DeepDiveDialog } from '@/components/deep-dive-dialog'
import { DiscussionPanel } from '@/components/discussion-panel'
import { ReactionBar } from '@/components/reaction-bar'
import { BookmarkButton } from '@/components/bookmark-button'
import { getAllArticles } from '@/lib/client/store'
import { PackArticle } from '@/lib/client/types'
import { decodeEmb, cosine, GROUPING_THRESHOLD } from '@/lib/client/engine'
import { recordInteraction, recordDwell } from '@/lib/client/interactions'
import { extractSourceName, stripHtml } from '@/lib/news'

interface RelatedItem {
    id: string
    title: string
    link: string
    source?: string
    similarity: number
}

function sourceOf(a: { source?: string; link: string }): string {
    return a.source || extractSourceName(a.link)
}

export function ArticleDetail({ id }: { id: string }) {
    const [article, setArticle] = useState<PackArticle | null>(null)
    const [pack, setPack] = useState<PackArticle[]>([])
    const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading')

    // 記事を開いた時点で「閲覧」を記録（既読反映・履歴）。
    // ベクトルへの反映は開いた瞬間ではなく、離脱時の閲覧時間(dwell)で重み付けする。
    useEffect(() => {
        recordInteraction(id, 'view')
    }, [id])

    // 閲覧時間・スクロール到達度の計測 → 離脱時に recordDwell（興味の強さ推定）
    useEffect(() => {
        if (status !== 'ready') return
        const scroller = document.querySelector('main')
        let activeMs = 0
        let start = document.visibilityState === 'visible' ? performance.now() : 0
        let maxScroll = 0
        let done = false

        const onScroll = () => {
            if (!scroller) return
            const denom = Math.max(1, scroller.scrollHeight - scroller.clientHeight)
            const d = denom <= 1 ? 1 : scroller.scrollTop / denom  // 短い記事は全部見えている=1
            if (d > maxScroll) maxScroll = Math.min(1, d)
        }
        onScroll()
        scroller?.addEventListener('scroll', onScroll, { passive: true })

        const pause = () => { if (start) { activeMs += performance.now() - start; start = 0 } }
        const resume = () => { if (!start) start = performance.now() }
        const onVis = () => { if (document.hidden) pause(); else resume() }
        const finalize = () => {
            if (done) return
            done = true
            pause()
            const sec = Math.round(activeMs / 1000)
            if (sec >= 2) recordDwell(id, sec, maxScroll)  // 2秒未満は誤操作として無視
        }

        document.addEventListener('visibilitychange', onVis)
        window.addEventListener('pagehide', finalize)
        return () => {
            document.removeEventListener('visibilitychange', onVis)
            window.removeEventListener('pagehide', finalize)
            scroller?.removeEventListener('scroll', onScroll)
            finalize()  // ページ遷移（アンマウント）で確定
        }
    }, [id, status])

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const all = await getAllArticles()
            if (cancelled) return
            setPack(all)
            const found = all.find(a => a.id === id)
            if (found) {
                setArticle(found)
                setStatus('ready')
                return
            }
            // キャッシュ未ヒット: 軽量APIで単体取得
            try {
                const res = await fetch(`/api/article/${id}`)
                if (!res.ok) throw new Error('not found')
                const data = await res.json()
                if (cancelled) return
                setArticle({ ...data, emb: null })
                setStatus('ready')
            } catch {
                if (!cancelled) setStatus('notfound')
            }
        }
        load()
        return () => { cancelled = true }
    }, [id])

    // ---- 関連記事を端末内の埋め込みで計算 ----
    const { sameGroup, similar, categoryArticles } = useMemo(() => {
        const empty = { sameGroup: [] as RelatedItem[], similar: [] as RelatedItem[], categoryArticles: [] as PackArticle[] }
        if (!article) return empty

        const others = pack.filter(a => a.id !== article.id)
        const matchedIds = new Set<string>()

        let sameGroup: RelatedItem[] = []
        let similar: RelatedItem[] = []

        if (article.emb) {
            const base = decodeEmb(article.emb)
            const scored = others
                .filter(a => a.emb)
                .map(a => ({ a, sim: cosine(base, decodeEmb(a.emb!)) }))
                .sort((x, y) => y.sim - x.sim)

            sameGroup = scored
                .filter(s => s.sim >= GROUPING_THRESHOLD)
                .slice(0, 3)
                .map(s => ({ id: s.a.id, title: s.a.title, link: s.a.link, source: s.a.source, similarity: s.sim }))
            sameGroup.forEach(s => matchedIds.add(s.id))

            similar = scored
                .filter(s => s.sim >= GROUPING_THRESHOLD - 0.15 && s.sim < GROUPING_THRESHOLD)
                .slice(0, 3)
                .map(s => ({ id: s.a.id, title: s.a.title, link: s.a.link, source: s.a.source, similarity: s.sim }))
            similar.forEach(s => matchedIds.add(s.id))
        }

        // カテゴリ別の関連（RSSカテゴリで最新順）
        const cats = (article.category || '').split(',').map(c => c.trim()).filter(Boolean)
        const primary = cats.find(c => c !== 'その他') || cats[0]
        let categoryArticles: PackArticle[] = []
        if (primary && primary !== 'その他') {
            categoryArticles = others
                .filter(a => (a.category || '').includes(primary) && !matchedIds.has(a.id))
                .sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || ''))
                .slice(0, 3)
        }

        return { sameGroup, similar, categoryArticles }
    }, [article, pack])

    if (status === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        )
    }

    if (status === 'notfound' || !article) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-muted-foreground">
                <p className="text-sm">記事が見つかりませんでした</p>
                <Button variant="outline" size="sm" asChild className="border-border">
                    <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" />一覧に戻る</Link>
                </Button>
            </div>
        )
    }

    const categories = (article.category || '').split(',').map(c => c.trim()).filter(Boolean)
    const keywords: string[] = article.category_minor || []
    const primary = categories.find(c => c !== 'その他') || categories[0]

    const f = article.fact_score ?? 0
    const c = article.context_score ?? 0
    const p = article.perspective_score ?? 0
    const e = article.emotion_score ?? 0
    const i = article.immediacy_score ?? 0
    const hasNutrients = f > 0 || c > 0 || p > 0 || e > 0 || i > 0

    return (
        <div className="min-h-screen bg-background text-foreground py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <header className="mb-6 flex items-center justify-between gap-3">
                    <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground pl-0">
                        <Link href="/">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            一覧に戻る
                        </Link>
                    </Button>
                    <BookmarkButton articleId={article.id} />
                </header>

                <article className="space-y-8">
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            {categories.map((cat) => (
                                <Badge key={cat} variant="secondary" className="bg-accent text-primary border-primary/25">
                                    {cat}
                                </Badge>
                            ))}
                            {article.category_medium && article.category_medium !== 'その他' && (
                                <Badge variant="secondary" className="bg-emerald-50 text-emerald-600 border-emerald-200">
                                    {article.category_medium}
                                </Badge>
                            )}
                        </div>

                        <h1 className="text-2xl md:text-3xl font-bold leading-tight text-foreground">
                            {article.title}
                        </h1>

                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {article.published ? new Date(article.published).toLocaleDateString('ja-JP') : '日付不明'}
                            </span>
                        </div>

                        {keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 items-center">
                                <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                                {keywords.map((kw) => (
                                    <span key={kw} className="inline-block bg-card border border-border px-2 py-0.5 rounded-full text-[11px] text-muted-foreground">
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {article.image_url && (
                        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border shadow-sm bg-card">
                            <SafeImage src={article.image_url} alt={article.title} className="w-full h-full object-cover" />
                        </div>
                    )}

                    <div className="bg-card border border-border rounded-xl p-6 md:p-8">
                        <h2 className="text-xl font-bold text-foreground mb-4">概要</h2>
                        <p className="text-zinc-700 leading-relaxed text-lg whitespace-pre-wrap">
                            {stripHtml(article.summary)}
                        </p>
                    </div>

                    {/* この記事への反応（1タップの主観表明）— 栄養素より先に */}
                    <ReactionBar articleId={article.id} />

                    {/* 栄養素 */}
                    <div className="bg-card border border-border rounded-xl p-6">
                        <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                            <span className="text-primary">⚡</span> ニュースの栄養素
                        </h2>
                        {hasNutrients ? (
                            <>
                                <p className="text-sm text-muted-foreground mb-6">
                                    この記事に含まれる要素を5つの観点で分析しました。
                                </p>
                                <div className="h-[300px] w-full">
                                    <ClientNutrientRadar fact={f} context={c} perspective={p} emotion={e} immediacy={i} />
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4 text-xs text-muted-foreground text-center">
                                    <div>事実: <span className="text-zinc-700">{f}</span></div>
                                    <div>背景: <span className="text-zinc-700">{c}</span></div>
                                    <div>視点: <span className="text-zinc-700">{p}</span></div>
                                    <div>感情: <span className="text-zinc-700">{e}</span></div>
                                    <div>速報: <span className="text-zinc-700">{i}</span></div>
                                </div>
                            </>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                この記事はまだ栄養素が分析されていません（順次反映されます）。
                            </p>
                        )}
                    </div>

                    <div className="flex justify-center pt-4">
                        <Button variant="outline" size="lg" asChild className="bg-accent border-primary/25 text-primary hover:bg-accent hover:text-accent-foreground gap-2 w-full max-w-sm">
                            <a href={article.link} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-5 h-5" />
                                元の記事を読む（{sourceOf(article)}）
                            </a>
                        </Button>
                    </div>


                    {/* みんなの反応（X連携＋はてブコメント） */}
                    <DiscussionPanel title={article.title} link={article.link} />

                    {/* 別の視点で読む（同一トピック） */}
                    {sameGroup.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-foreground border-l-4 border-primary pl-3">
                                別の視点で読む（{sameGroup.length}）
                            </h3>
                            <div className="grid gap-3">
                                {sameGroup.map((src) => (
                                    <Link key={src.id} href={`/article/${src.id}`}
                                        className="p-3 rounded-lg bg-card border border-border flex items-center justify-between hover:bg-secondary transition-colors">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm text-zinc-700 line-clamp-1">{src.title}</span>
                                                <Badge variant="outline" className="text-[9px] h-4 px-1 bg-accent text-primary border-primary/25">
                                                    {Math.round(src.similarity * 100)}% Match
                                                </Badge>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground uppercase">{sourceOf(src)}</span>
                                        </div>
                                        <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* こちらもおすすめ（広めの類似） */}
                    {similar.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-muted-foreground border-l-4 border-border pl-3">
                                こちらの記事もおすすめ
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {similar.map((src) => (
                                    <Link key={src.id} href={`/article/${src.id}`}
                                        className="group p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-all">
                                        <span className="text-xs text-muted-foreground uppercase mb-2 block">{sourceOf(src)}</span>
                                        <h4 className="text-sm font-medium text-zinc-700 line-clamp-2 group-hover:text-primary transition-colors">
                                            {src.title}
                                        </h4>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* カテゴリ別 */}
                    {categoryArticles.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-emerald-600 border-l-4 border-emerald-500 pl-3">
                                「{primary}」の他の記事
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {categoryArticles.map((src) => (
                                    <Link key={src.id} href={`/article/${src.id}`}
                                        className="group p-4 rounded-xl bg-emerald-50/60 border border-emerald-200/60 hover:border-emerald-200 transition-all">
                                        <span className="text-xs text-muted-foreground uppercase mb-2 block">{sourceOf(src)}</span>
                                        <h4 className="text-sm font-medium text-zinc-700 line-clamp-2 group-hover:text-emerald-600 transition-colors">
                                            {src.title}
                                        </h4>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-border">
                        <DeepDiveDialog
                            article={{ id: article.id, title: article.title, summary: article.summary, link: article.link, published: article.published }}
                            trigger={
                                <Button variant="outline" size="lg"
                                    className="bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 gap-2 flex-1">
                                    <Sparkles className="w-5 h-5" />
                                    AIで深掘り解説
                                </Button>
                            }
                        />
                    </div>
                </article>
            </div>
        </div>
    )
}
