import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ExternalLink, Calendar, Tag } from 'lucide-react'
import Link from 'next/link'
import { DeepDiveDialog } from '@/components/deep-dive-dialog'
import { Sparkles } from 'lucide-react'
import { Article } from '@/lib/types'
import { SafeImage } from '@/components/safe-image'
import { ClientNutrientRadar } from '@/components/client-nutrient-radar'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ArticlePage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { id } = await params
    void searchParams  // unused but required by Next.js page signature
    const supabase = await createClient()

    const { data: article, error } = await supabase
        .from('articles')
        .select('*, embedding_m3, category_medium, category_minor')
        .eq('id', id)
        .single()

    if (error || !article) {
        notFound()
    }

    const groupingThreshold = 0.92  // fixed — grouping slider removed

    const categories = article.category ? article.category.split(',').filter((c: string) => c.trim()) : []
    const keywords: string[] = article.category_minor || []

    // Fetch related articles via BGE-M3 RPC (only if embedding exists)
    let sameGroup: (Article & { similarity: number })[] = []
    let similarArticles: (Article & { similarity: number })[] = []
    let vectorMatchIds = new Set<string>()

    if (article.embedding_m3) {
        const { data: related } = await supabase.rpc('match_articles_m3', {
            query_vector: article.embedding_m3,
            match_count: 20
        })
        const allMatches = (related || [])
            .filter((r: Article & { similarity: number }) => r.id !== article.id)
        vectorMatchIds = new Set(allMatches.map((r: Article) => r.id))
        sameGroup = allMatches
            .filter((r: Article & { similarity: number }) => r.similarity >= groupingThreshold)
            .slice(0, 3)
        similarArticles = allMatches
            .filter((r: Article & { similarity: number }) => r.similarity >= groupingThreshold - 0.15 && r.similarity < groupingThreshold)
            .slice(0, 3)
    }

    // Category-based related articles — use RSS category field (not category_medium which is broken)
    let categoryArticles: Article[] = []
    const articleCategories = (article.category || '').split(',').map((c: string) => c.trim()).filter(Boolean)
    const primaryCategory = articleCategories.find((c: string) => c !== 'その他') || articleCategories[0]

    if (primaryCategory && primaryCategory !== 'その他') {
        const { data: catRelated } = await supabase
            .from('articles')
            .select('id, title, link, summary, published, category, image_url, source')
            .like('category', `%${primaryCategory}%`)
            .neq('id', article.id)
            .order('collected_at', { ascending: false })
            .limit(10)

        categoryArticles = (catRelated || [])
            .filter((r: Article) => !vectorMatchIds.has(r.id))
            .slice(0, 3)
    }

    return (
        <div className="min-h-screen bg-background text-foreground py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground pl-0">
                        <Link href="/">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            一覧に戻る
                        </Link>
                    </Button>

                </header>

                <article className="space-y-8">
                    {/* Header Section */}
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            {categories.map((cat: string) => (
                                <Badge
                                    key={cat}
                                    variant="secondary"
                                    className="bg-accent text-primary border-primary/25"
                                >
                                    {cat}
                                </Badge>
                            ))}
                            {article.category_medium && article.category_medium !== 'その他' && (
                                <Badge
                                    variant="secondary"
                                    className="bg-emerald-50 text-emerald-600 border-emerald-200"
                                >
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

                        {/* Keyword Tags */}
                        {keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 items-center">
                                <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                                {keywords.map((kw: string) => (
                                    <span
                                        key={kw}
                                        className="inline-block bg-card border border-border px-2 py-0.5 rounded-full text-[11px] text-muted-foreground"
                                    >
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Image */}
                    {article.image_url && (
                        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border shadow-2xl bg-card">
                            <SafeImage
                                src={article.image_url}
                                alt={article.title}
                                className="w-full h-full object-cover"
                            />
                        </div>
                    )}

                    {/* Content/Summary */}
                    <div className="bg-card border border-border rounded-xl p-6 md:p-8">
                        <h2 className="text-xl font-bold text-foreground mb-4">概要</h2>
                        <p className="text-zinc-700 leading-relaxed text-lg whitespace-pre-wrap">
                            {article.summary}
                        </p>
                    </div>

                    {/* Nutrient Radar */}
                    {(() => {
                        const f = article.fact_score ?? 0
                        const c = article.context_score ?? 0
                        const p = article.perspective_score ?? 0
                        const e = article.emotion_score ?? 0
                        const i = article.immediacy_score ?? 0
                        const hasData = f > 0 || c > 0 || p > 0 || e > 0 || i > 0
                        return (
                            <div className="bg-card border border-border rounded-xl p-6">
                                <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
                                    <span className="text-primary">⚡</span> ニュースの栄養素
                                </h2>
                                {hasData ? (
                                    <>
                                        <p className="text-sm text-muted-foreground mb-6">
                                            この記事に含まれる要素を5つの観点で分析しました。
                                        </p>
                                        <div className="h-[300px] w-full">
                                            <ClientNutrientRadar
                                                fact={f}
                                                context={c}
                                                perspective={p}
                                                emotion={e}
                                                immediacy={i}
                                            />
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
                                        この記事はまだ栄養素が分析されていません。
                                    </p>
                                )}
                            </div>
                        )
                    })()}

                    {/* Main Source Button (Always Visible) */}
                    <div className="flex justify-center pt-4">
                        <Button variant="outline" size="lg" asChild className="bg-accent border-primary/25 text-primary hover:bg-accent hover:text-accent-foreground gap-2 w-full max-w-sm">
                            <a href={article.link} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-5 h-5" />
                                元の記事を読む ({article.source || new URL(article.link).hostname})
                            </a>
                        </Button>
                    </div>

                    {/* Related Sources (Same Group) */}
                    {sameGroup.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-foreground border-l-4 border-primary pl-3">
                                別の視点で読む ({sameGroup.length}) <span className="text-xs font-normal text-muted-foreground ml-2">しきい値: {groupingThreshold.toFixed(3)}</span>
                            </h3>
                            <div className="grid gap-3">
                                {sameGroup.map((src: Article & { similarity: number }) => (
                                    <Link
                                        key={src.id}
                                        href={`/article/${src.id}`}
                                        className="p-3 rounded-lg bg-card border border-border flex items-center justify-between hover:bg-secondary transition-colors"
                                    >
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm text-zinc-700 line-clamp-1">{src.title}</span>
                                                <Badge variant="outline" className="text-[9px] h-4 px-1 bg-accent text-primary border-primary/25">
                                                    {Math.round(src.similarity * 100)}% Match
                                                </Badge>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground uppercase">{src.source || new URL(src.link).hostname}</span>
                                        </div>
                                        <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Similar Articles (Broad Similarity) */}
                    {similarArticles.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-muted-foreground border-l-4 border-border pl-3">
                                こちらの記事もおすすめ
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {similarArticles.slice(0, 4).map((src: Article & { similarity: number }) => (
                                    <Link
                                        key={src.id}
                                        href={`/article/${src.id}`}
                                        className="group p-4 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
                                    >
                                        <span className="text-xs text-muted-foreground uppercase mb-2 block">{src.source || new URL(src.link).hostname}</span>
                                        <h4 className="text-sm font-medium text-zinc-700 line-clamp-2 group-hover:text-primary transition-colors">
                                            {src.title}
                                        </h4>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Category-based Related Articles */}
                    {categoryArticles.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-emerald-600 border-l-4 border-emerald-500 pl-3">
                                「{primaryCategory}」の他の記事
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {categoryArticles.map((src: Article) => (
                                    <Link
                                        key={src.id}
                                        href={`/article/${src.id}`}
                                        className="group p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 hover:border-emerald-200 transition-all"
                                    >
                                        <span className="text-xs text-muted-foreground uppercase mb-2 block">{src.source || new URL(src.link).hostname}</span>
                                        <h4 className="text-sm font-medium text-zinc-700 line-clamp-2 group-hover:text-emerald-600 transition-colors">
                                            {src.title}
                                        </h4>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-border">
                        <DeepDiveDialog
                            article={article}
                            trigger={
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 gap-2 flex-1"
                                >
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
