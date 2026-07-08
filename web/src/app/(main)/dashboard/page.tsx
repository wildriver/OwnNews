'use client'

// Information Health ダッシュボード（ローカル計算版）
// すべての統計をIndexedDB内の閲覧履歴と記事パックから計算する。
// サーバへの問い合わせは発生しない。

import { useState, useEffect, useMemo } from 'react'
import { HealthRadarInfo } from '@/components/health-radar'
import { ActivityBarChart } from '@/components/activity-chart'
import { TopicTreemap } from '@/components/topic-treemap'
import { KeywordBar } from '@/components/keyword-cloud'
import { NutrientRadarInfo } from '@/components/nutrient-radar-info'
import { TopicTransitionChart } from '@/components/topic-transition-chart'
import { GlobalCategoryBar } from '@/components/global-category-bar'
import {
    computeHealthStats,
    computeActivityHistory,
    computeHealthSeries,
    computeGlobalCategoryDistribution,
    Period,
} from '@/lib/client/health-local'
import { getAllInteractions, getAllArticles } from '@/lib/client/store'
import { LocalInteraction, PackArticle } from '@/lib/client/types'
import { SYNCED_EVENT } from '@/lib/client/sync'
import { Loader2 } from 'lucide-react'

export default function DashboardPage() {
    const [period, setPeriod] = useState<Period>('30d')
    const [interactions, setInteractions] = useState<LocalInteraction[] | null>(null)
    const [articles, setArticles] = useState<PackArticle[]>([])

    useEffect(() => {
        let cancelled = false
        const load = () => Promise.all([getAllInteractions(), getAllArticles()]).then(([ints, arts]) => {
            if (cancelled) return
            setInteractions(ints)
            setArticles(arts)
        })
        load()
        // 運営Supabaseからの同期完了で最新化
        window.addEventListener(SYNCED_EVENT, load)
        return () => { cancelled = true; window.removeEventListener(SYNCED_EVENT, load) }
    }, [])

    const periodLabel = period === '7d' ? '過去1週間' : period === '30d' ? '過去1ヶ月' : '過去3ヶ月'

    const healthStats = useMemo(
        () => interactions ? computeHealthStats(interactions, period) : null,
        [interactions, period]
    )
    const activityHistory = useMemo(
        () => interactions ? computeActivityHistory(interactions) : [],
        [interactions]
    )
    const healthSeries = useMemo(
        () => interactions ? computeHealthSeries(interactions, period) : [],
        [interactions, period]
    )
    const globalCategoryDist = useMemo(
        () => computeGlobalCategoryDistribution(articles),
        [articles]
    )

    if (!interactions || !healthStats) {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        )
    }

    const topMedium = Object.entries(healthStats.medium_distribution)
        .sort((a, b) => b[1] - a[1])[0]

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">情報的健康</h1>
                        <p className="text-muted-foreground">あなたの情報摂取バランスと活動履歴（アカウントに同期・集計は端末側）</p>
                    </div>

                    <div className="flex bg-card border border-border p-1 rounded-lg">
                        {([
                            { id: '7d', label: '1週' },
                            { id: '30d', label: '1月' },
                            { id: '90d', label: '3月' },
                        ] as { id: Period; label: string }[]).map((p) => (
                            <button
                                key={p.id}
                                onClick={() => setPeriod(p.id)}
                                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p.id
                                    ? 'bg-primary text-white'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-card'
                                    }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </header>

                <div className="bg-card border border-border rounded-xl p-6">
                    <h3 className="text-lg font-bold text-foreground mb-4">{periodLabel}のサマリー</h3>
                    <div className="text-zinc-700 leading-relaxed text-sm space-y-2">
                        <p>
                            この期間中、<span className="text-primary font-bold">{healthStats.total_viewed}記事</span>を分析しています。
                            情報摂取のバランス判定は<span className="text-indigo-600 font-bold">「{healthStats.bias_level}」</span>です。
                        </p>
                    </div>
                </div>

                {/* Row 1: Radar (Category + Nutrient) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <HealthRadarInfo distribution={healthStats.category_distribution} label={periodLabel} />
                    <NutrientRadarInfo averages={healthStats.nutrient_averages} />
                </div>

                {/* Row 2: Activity */}
                <ActivityBarChart data={activityHistory} />

                {/* Row 2: Transition Line Chart */}
                <TopicTransitionChart series={healthSeries} />

                {/* Row 3: Global article distribution */}
                <GlobalCategoryBar data={globalCategoryDist} />

                {/* Row 4: Treemap + Keyword Bar */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <TopicTreemap distribution={healthStats.medium_distribution} />
                    <KeywordBar data={healthStats.top_keywords} />
                </div>

                <div className="bg-card border border-border rounded-xl p-6">
                    <h3 className="text-lg font-bold text-foreground mb-4">詳細分析</h3>
                    <div className="text-zinc-700 leading-relaxed text-sm space-y-2">
                        {healthStats.dominant_category && (
                            <p>
                                最も多く接しているトピックは<span className="text-primary font-bold">「{healthStats.dominant_category}」</span>で、全体の{Math.round(healthStats.dominant_ratio * 100)}%を占めています。
                            </p>
                        )}
                        {topMedium && (
                            <p>
                                中分類で最も注目しているテーマは<span className="text-emerald-600 font-bold">「{topMedium[0]}」</span>（{topMedium[1]}件）です。
                            </p>
                        )}
                        {healthStats.top_keywords.length > 0 && (
                            <p>
                                頻出キーワード: {healthStats.top_keywords.slice(0, 5).map((kw, i) => (
                                    <span key={kw.keyword}>
                                        {i > 0 && '、'}
                                        <span className="text-violet-600 font-medium">{kw.keyword}</span>
                                        <span className="text-muted-foreground text-xs">({kw.count})</span>
                                    </span>
                                ))}
                            </p>
                        )}
                        {healthStats.missing_categories.length > 0 && (
                            <p>
                                以下のトピックに触れることで、視野を広げることができます：
                                <span className="block mt-2">
                                    {healthStats.missing_categories.map(c => (
                                        <span key={c} className="inline-block bg-secondary px-2 py-1 rounded mr-2 text-xs text-foreground border border-border">
                                            {c}
                                        </span>
                                    ))}
                                </span>
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
