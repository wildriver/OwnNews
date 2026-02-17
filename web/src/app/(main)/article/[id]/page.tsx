import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ExternalLink, Calendar, Tag } from 'lucide-react'
import Link from 'next/link'
import { DeepDiveDialog } from '@/components/deep-dive-dialog'
import { Sparkles } from 'lucide-react'
import { Article } from '@/lib/types'
import { SafeImage } from '@/components/safe-image'
import { FilterSlider } from '@/components/filter-slider'
import { GroupingSlider } from '@/components/grouping-slider'
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
    const params_url = await searchParams
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const { data: article, error } = await supabase
        .from('articles')
        .select('*, embedding_m3, category_medium, category_minor')
        .eq('id', id)
        .single()

    if (error || !article) {
        notFound()
    }

    // Fetch preferences from profile or URL
    let groupingThreshold = 0.92
    let filterStrength = 0.50

    const { data: profile } = await supabase
        .from('user_profile')
        .select('grouping_threshold, filter_strength')
        .eq('user_id', user.email)
        .single()

    const rawGrouping = typeof params_url?.grouping === 'string'
        ? parseFloat(params_url.grouping)
        : (profile?.grouping_threshold ?? 0.92)
    groupingThreshold = Math.max(0.70, Math.min(0.99, rawGrouping || 0.92))

    const rawStrength = typeof params_url?.strength === 'string'
        ? parseFloat(params_url.strength)
        : (profile?.filter_strength ?? 0.50)
    filterStrength = Math.max(0, Math.min(1, rawStrength || 0.50))

    const categories = article.category ? article.category.split(',').filter((c: string) => c.trim()) : []
    const keywords: string[] = article.category_minor || []

    // Fetch related articles (sources) using BGE-M3 RPC
    const { data: related } = await supabase.rpc('match_articles_m3', {
        query_vector: article.embedding_m3,
        match_count: 100
    })

    const allMatches = (related || [])
        .filter((r: Article & { similarity: number }) => r.id !== article.id)

    // Use dynamic grouping threshold
    const sameGroup = allMatches.filter((r: Article & { similarity: number }) => r.similarity >= groupingThreshold)
    const similarArticles = allMatches.filter((r: Article & { similarity: number }) => r.similarity >= groupingThreshold - 0.15 && r.similarity < groupingThreshold)

    // Fetch category-based related articles (same category_medium, different from vector matches)
    const vectorMatchIds = new Set(allMatches.map((r: Article) => r.id))
    let categoryArticles: Article[] = []

    if (article.category_medium && article.category_medium !== 'その他') {
        const { data: catRelated } = await supabase
            .from('articles')
            .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, source')
            .eq('category_medium', article.category_medium)
            .neq('id', article.id)
            .order('published', { ascending: false })
            .limit(8)

        categoryArticles = (catRelated || [])
            .filter((r: Article) => !vectorMatchIds.has(r.id))
            .slice(0, 4)
    }

    return (
        <div className="min-h-screen bg-background text-foreground py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <Button variant="ghost" size="sm" asChild className="text-slate-400 hover:text-slate-200 pl-0">
                        <Link href="/">
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            一覧に戻る
                        </Link>
                    </Button>

                    <div className="flex flex-col md:flex-row gap-4 items-center w-full md:w-auto">
                        <FilterSlider initialValue={filterStrength} />
                        <GroupingSlider initialValue={groupingThreshold} />
                    </div>
                </header>

                <article className="space-y-8">
                    {/* Header Section */}
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            {categories.map((cat: string) => (
                                <Badge
                                    key={cat}
                                    variant="secondary"
                                    className="bg-sky-500/10 text-sky-400 border-sky-500/20"
                                >
                                    {cat}
                                </Badge>
                            ))}
                            {article.category_medium && article.category_medium !== 'その他' && (
                                <Badge
                                    variant="secondary"
                                    className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                >
                                    {article.category_medium}
                                </Badge>
                            )}
                        </div>

                        <h1 className="text-3xl md:text-4xl font-bold leading-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 to-slate-400">
                            {article.title}
                        </h1>

                        <div className="flex items-center gap-4 text-sm text-slate-400">
                            <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" />
                                {article.published ? new Date(article.published).toLocaleDateString('ja-JP') : '日付不明'}
                            </span>
                        </div>

                        {/* Keyword Tags */}
                        {keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 items-center">
                                <Tag className="w-3.5 h-3.5 text-slate-500" />
                                {keywords.map((kw: string) => (
                                    <span
                                        key={kw}
                                        className="inline-block bg-white/5 border border-white/10 px-2 py-0.5 rounded-full text-[11px] text-slate-400"
                                    >
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Image */}
                    {article.image_url && (
                        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 shadow-2xl bg-white/5">
                            <SafeImage
                                src={article.image_url}
                                alt={article.title}
                                className="w-full h-full object-cover"
                            />
                        </div>
                    )}

                    {/* Content/Summary */}
                    <div className="bg-white/5 border border-white/10 rounded-xl p-6 md:p-8 backdrop-blur-sm">
                        <h2 className="text-xl font-bold text-slate-200 mb-4">概要</h2>
                        <p className="text-slate-300 leading-relaxed text-lg whitespace-pre-wrap">
                            {article.summary}
                        </p>
                    </div>

                    {/* Nutrient Radar */}
                    {(article.fact_score !== undefined || article.fact_score > 0) && (
                        <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
                            <h2 className="text-xl font-bold text-slate-200 mb-4 flex items-center gap-2">
                                <span className="text-sky-400">⚡</span> ニュースの栄養素
                            </h2>
                            <p className="text-sm text-slate-400 mb-6">
                                この記事に含まれる要素を5つの観点で分析しました。
                            </p>
                            <div className="h-[300px] w-full">
                                <ClientNutrientRadar
                                    fact={article.fact_score || 0}
                                    context={article.context_score || 0}
                                    perspective={article.perspective_score || 0}
                                    emotion={article.emotion_score || 0}
                                    immediacy={article.immediacy_score || 0}
                                />
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4 text-xs text-slate-500 text-center">
                                <div>事実: <span className="text-slate-300">{article.fact_score || 0}</span></div>
                                <div>背景: <span className="text-slate-300">{article.context_score || 0}</span></div>
                                <div>視点: <span className="text-slate-300">{article.perspective_score || 0}</span></div>
                                <div>感情: <span className="text-slate-300">{article.emotion_score || 0}</span></div>
                                <div>速報: <span className="text-slate-300">{article.immediacy_score || 0}</span></div>
                            </div>
                        </div>
                    )}

                    {/* Main Source Button (Always Visible) */}
                    <div className="flex justify-center pt-4">
                        <Button variant="outline" size="lg" asChild className="bg-sky-500/10 border-sky-500/20 text-sky-400 hover:bg-sky-500/20 hover:text-sky-300 gap-2 w-full max-w-sm">
                            <a href={article.link} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-5 h-5" />
                                元の記事を読む ({article.source || new URL(article.link).hostname})
                            </a>
                        </Button>
                    </div>

                    {/* Related Sources (Same Group) */}
                    {sameGroup.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-slate-200 border-l-4 border-sky-500 pl-3">
                                別の視点で読む ({sameGroup.length}) <span className="text-xs font-normal text-slate-500 ml-2">しきい値: {groupingThreshold.toFixed(3)}</span>
                            </h3>
                            <div className="grid gap-3">
                                {sameGroup.map((src: Article & { similarity: number }) => (
                                    <Link
                                        key={src.id}
                                        href={`/article/${src.id}`}
                                        className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between hover:bg-white/10 transition-colors"
                                    >
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-sm text-slate-300 line-clamp-1">{src.title}</span>
                                                <Badge variant="outline" className="text-[9px] h-4 px-1 bg-sky-500/10 text-sky-500 border-sky-500/20">
                                                    {Math.round(src.similarity * 100)}% Match
                                                </Badge>
                                            </div>
                                            <span className="text-[10px] text-slate-500 uppercase">{src.source || new URL(src.link).hostname}</span>
                                        </div>
                                        <ArrowLeft className="w-4 h-4 text-slate-500 rotate-180" />
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Similar Articles (Broad Similarity) */}
                    {similarArticles.length > 0 && (
                        <div className="space-y-4 pt-6">
                            <h3 className="text-lg font-bold text-slate-400 border-l-4 border-slate-700 pl-3">
                                こちらの記事もおすすめ
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {similarArticles.slice(0, 4).map((src: Article & { similarity: number }) => (
                                    <Link
                                        key={src.id}
                                        href={`/article/${src.id}`}
                                        className="group p-4 rounded-xl bg-white/5 border border-white/10 hover:border-sky-500/30 transition-all"
                                    >
                                        <span className="text-xs text-slate-500 uppercase mb-2 block">{src.source || new URL(src.link).hostname}</span>
                                        <h4 className="text-sm font-medium text-slate-300 line-clamp-2 group-hover:text-sky-400 transition-colors">
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
                            <h3 className="text-lg font-bold text-emerald-400 border-l-4 border-emerald-500 pl-3">
                                「{article.category_medium}」の他の記事
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {categoryArticles.map((src: Article) => (
                                    <Link
                                        key={src.id}
                                        href={`/article/${src.id}`}
                                        className="group p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 hover:border-emerald-500/30 transition-all"
                                    >
                                        <span className="text-xs text-slate-500 uppercase mb-2 block">{src.source || new URL(src.link).hostname}</span>
                                        <h4 className="text-sm font-medium text-slate-300 line-clamp-2 group-hover:text-emerald-400 transition-colors">
                                            {src.title}
                                        </h4>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-col sm:flex-row gap-4 pt-4 border-t border-white/10">
                        <DeepDiveDialog
                            article={article}
                            trigger={
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="bg-indigo-500/10 border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-300 gap-2 flex-1"
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
