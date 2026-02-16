import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { HealthRadarInfo } from '@/components/health-radar'
import { ActivityBarChart } from '@/components/activity-chart'
import { TopicTreemap } from '@/components/topic-treemap'
import { KeywordBar } from '@/components/keyword-cloud'
import { TopicTransitionChart } from '@/components/topic-transition-chart'
import { getInformationHealth, getActivityHistory, getInformationHealthSeries } from '@/lib/health'
import Link from 'next/link'

export const runtime = 'edge'

export default async function DashboardPage({
    searchParams,
}: {
    searchParams: Promise<{ period?: string }>
}) {
    const supabase = await createClient()
    const { period: periodParam } = await searchParams
    const period = (periodParam as '7d' | '30d' | '90d') || '30d'
    const periodLabel = period === '7d' ? '過去1週間' : period === '30d' ? '過去1ヶ月' : '過去3ヶ月'

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // Fetch Real Data
    const [healthStats, activityHistory, healthSeries] = await Promise.all([
        getInformationHealth(supabase, user.email || '', period),
        getActivityHistory(supabase, user.email || ''),
        getInformationHealthSeries(supabase, user.email || '', period)
    ])

    // Find the most dominant medium category for summary
    const topMedium = Object.entries(healthStats.medium_distribution)
        .sort((a, b) => b[1] - a[1])[0]

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
                            Information Health
                        </h1>
                        <p className="text-slate-400">あなたの情報摂取バランスと活動履歴</p>
                    </div>

                    <div className="flex bg-white/5 border border-white/10 p-1 rounded-lg">
                        {[
                            { id: '7d', label: '1週' },
                            { id: '30d', label: '1月' },
                            { id: '90d', label: '3月' },
                        ].map((p) => (
                            <Link
                                key={p.id}
                                href={`/dashboard?period=${p.id}`}
                                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p.id
                                    ? 'bg-sky-500 text-white'
                                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                                    }`}
                            >
                                {p.label}
                            </Link>
                        ))}
                    </div>
                </header>

                <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
                    <h3 className="text-lg font-bold text-slate-200 mb-4">{periodLabel}のサマリー</h3>
                    <div className="text-slate-300 leading-relaxed text-sm space-y-2">
                        <p>
                            この期間中、<span className="text-sky-400 font-bold">{healthStats.total_viewed}記事</span>を分析しています。
                            情報摂取のバランス判定は<span className="text-indigo-400 font-bold">「{healthStats.bias_level}」</span>です。
                        </p>
                    </div>
                </div>

                {/* Row 1: Radar + Activity */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <HealthRadarInfo distribution={healthStats.category_distribution} label={periodLabel} />
                    <ActivityBarChart data={activityHistory} />
                </div>

                {/* Row 2: Transition Line Chart */}
                <TopicTransitionChart series={healthSeries} />

                {/* Row 3: Treemap + Keyword Bar */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <TopicTreemap distribution={healthStats.medium_distribution} />
                    <KeywordBar data={healthStats.top_keywords} />
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
                    <h3 className="text-lg font-bold text-slate-200 mb-4">詳細分析</h3>
                    <div className="text-slate-300 leading-relaxed text-sm space-y-2">
                        {healthStats.dominant_category && (
                            <p>
                                最も多く接しているトピックは<span className="text-sky-400 font-bold">「{healthStats.dominant_category}」</span>で、全体の{Math.round(healthStats.dominant_ratio * 100)}%を占めています。
                            </p>
                        )}
                        {topMedium && (
                            <p>
                                中分類で最も注目しているテーマは<span className="text-emerald-400 font-bold">「{topMedium[0]}」</span>（{topMedium[1]}件）です。
                            </p>
                        )}
                        {healthStats.top_keywords.length > 0 && (
                            <p>
                                頻出キーワード: {healthStats.top_keywords.slice(0, 5).map((kw, i) => (
                                    <span key={kw.keyword}>
                                        {i > 0 && '、'}
                                        <span className="text-violet-400 font-medium">{kw.keyword}</span>
                                        <span className="text-slate-500 text-xs">({kw.count})</span>
                                    </span>
                                ))}
                            </p>
                        )}
                        {healthStats.missing_categories.length > 0 && (
                            <p>
                                以下のトピックに触れることで、視野を広げることができます：
                                <span className="block mt-2">
                                    {healthStats.missing_categories.map(c => (
                                        <span key={c} className="inline-block bg-white/10 px-2 py-1 rounded mr-2 text-xs text-slate-200 border border-white/10">
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
