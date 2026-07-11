'use client'

// ダッシュボード先頭の「情報的健康」スコアカード。
// 以前は左サイドバー・上部サマリーボックス・最下段の詳細分析に分散していた
// 健康情報を1枚に集約する（ダッシュボードの主役として最初に表示）。

import Link from 'next/link'
import { Activity } from 'lucide-react'
import { HealthStats } from '@/lib/types'

function scoreColor(score: number) {
    if (score >= 70) return 'text-primary'
    if (score >= 40) return 'text-amber-600'
    return 'text-rose-600'
}

export function HealthScoreCard({ stats, periodLabel }: { stats: HealthStats; periodLabel: string }) {
    const topMedium = Object.entries(stats.medium_distribution || {}).sort((a, b) => b[1] - a[1])[0]
    return (
        <div className="bg-card border border-border rounded-xl p-6 flex flex-col">
            <h3 className="text-[13px] font-semibold text-muted-foreground flex items-center gap-1.5 mb-3">
                <Activity className="w-4 h-4" />情報的健康（{periodLabel}）
            </h3>

            <div className="flex items-end gap-3">
                <div className={`text-5xl font-bold tnum leading-none ${scoreColor(stats.diversity_score)}`}>
                    {stats.diversity_score}
                </div>
                <div className="pb-1">
                    <div className="text-[11px] text-muted-foreground">多様性スコア /100</div>
                    <div className="text-[14px] font-bold">{stats.bias_level}</div>
                </div>
            </div>

            {/* 分析ワンライナー（旧・サマリー/詳細分析の要点を集約） */}
            <div className="mt-4 text-[12.5px] leading-relaxed text-muted-foreground space-y-1.5">
                <p>
                    この期間に<span className="text-foreground font-semibold tnum">{stats.total_viewed}記事</span>を閲覧。
                    {stats.dominant_category && (
                        <>最も多いのは<span className="text-foreground font-semibold">「{stats.dominant_category}」</span>（{Math.round(stats.dominant_ratio * 100)}%）。</>
                    )}
                </p>
                {topMedium && (
                    <p>注目テーマは<span className="text-foreground font-semibold">「{topMedium[0]}」</span>（{topMedium[1]}件）。</p>
                )}
            </div>

            {/* 足りない栄養 = 処方箋（タップでそのジャンルへ） */}
            {stats.missing_categories.length > 0 && (
                <div className="mt-auto pt-4">
                    <div className="text-[11px] text-muted-foreground mb-1.5">足りない栄養 — タップして補給</div>
                    <div className="flex flex-wrap gap-1.5">
                        {stats.missing_categories.slice(0, 5).map(c => (
                            <Link
                                key={c}
                                href={`/?category=${encodeURIComponent(c)}`}
                                className="text-[12px] px-2 py-1 bg-secondary text-secondary-foreground rounded-md border border-border hover:text-primary hover:border-primary/40 transition-colors"
                            >
                                {c} →
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
