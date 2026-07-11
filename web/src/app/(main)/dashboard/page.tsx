'use client'

// Information Health ダッシュボード（ローカル計算版）
// すべての統計をIndexedDB内の閲覧履歴と記事パックから計算する。
// サーバへの問い合わせは発生しない（リアクション一覧のみ本人行をRLS下で取得）。
//
// 構成（重要度順）:
//   1. 情報的健康ヒーロー（スコア＋ジャンル・栄養レーダー）… 主役を最初に
//   2. 見落としニュース（みんなは読んでいる×あなたは未読）
//   3. トピック詳細・注目キーワード（クリックで読んだ記事一覧へ）
//   4. あなたのリアクション（タップで記事一覧）／あなたvs全体
//   5. 活動・時間帯
//   6. 推移・季節（長期利用向け）・記事母集団 … 後半へ

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { HealthScoreCard } from '@/components/health-score-card'
import { HealthRadarInfo } from '@/components/health-radar'
import { NutrientRadarInfo } from '@/components/nutrient-radar-info'
import { MissedNews } from '@/components/missed-news'
import { TopicTreemap } from '@/components/topic-treemap'
import { KeywordBar } from '@/components/keyword-cloud'
import { ReactionExplorer } from '@/components/reaction-explorer'
import { CategoryCompare } from '@/components/category-compare'
import { ActivityBarChart } from '@/components/activity-chart'
import { TopicTransitionChart } from '@/components/topic-transition-chart'
import { GlobalCategoryBar } from '@/components/global-category-bar'
import { SeasonalCategoryChart, HourlyActivityChart } from '@/components/seasonal-chart'
import {
    computeHealthStats,
    computeActivityHistory,
    computeHealthSeries,
    computeGlobalCategoryDistribution,
    computeSeasonalCategories,
    computeHourlyDistribution,
    Period,
} from '@/lib/client/health-local'
import { getAllInteractions, getAllArticles } from '@/lib/client/store'
import { LocalInteraction, PackArticle } from '@/lib/client/types'
import { SYNCED_EVENT } from '@/lib/client/sync'
import { Loader2 } from 'lucide-react'

export default function DashboardPage() {
    const router = useRouter()
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
    // Phase 2: 季節・時間帯の関心（全期間の履歴から集計。期間フィルタ非依存）
    const seasonal = useMemo(
        () => interactions ? computeSeasonalCategories(interactions) : { data: [], categories: [], total: 0 },
        [interactions]
    )
    const hourly = useMemo(
        () => interactions ? computeHourlyDistribution(interactions) : [],
        [interactions]
    )

    if (!interactions || !healthStats) {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        )
    }

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

                {/* 1. 情報的健康ヒーロー: スコア + ジャンルレーダー + 栄養レーダー */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <HealthScoreCard stats={healthStats} periodLabel={periodLabel} />
                    <HealthRadarInfo distribution={healthStats.category_distribution} label={periodLabel} />
                    <NutrientRadarInfo averages={healthStats.nutrient_averages} />
                </div>

                {/* 2. 見落としニュース（みんなは読んでいる × あなたは未読） */}
                <MissedNews articles={articles} interactions={interactions} />

                {/* 3. トピック詳細・注目キーワード（クリックで読んだ記事一覧へ） */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <TopicTreemap
                        distribution={healthStats.medium_distribution}
                        onSelect={(m) => router.push(`/history?cat=${encodeURIComponent(m)}`)}
                    />
                    <KeywordBar
                        data={healthStats.top_keywords}
                        onSelect={(kw) => router.push(`/history?kw=${encodeURIComponent(kw)}`)}
                    />
                </div>

                {/* 4. リアクション探索 ＋ あなたvs全体 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
                    <ReactionExplorer articles={articles} interactions={interactions} />
                    <CategoryCompare articles={articles} myDistribution={healthStats.category_distribution} />
                </div>

                {/* 5. 活動・時間帯 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <ActivityBarChart data={activityHistory} />
                    <HourlyActivityChart data={hourly} />
                </div>

                {/* 6. 長期向け: 推移・季節・記事母集団 */}
                <TopicTransitionChart series={healthSeries} />
                <SeasonalCategoryChart data={seasonal.data} categories={seasonal.categories} total={seasonal.total} />
                <GlobalCategoryBar data={globalCategoryDist} />
            </div>
        </div>
    )
}
