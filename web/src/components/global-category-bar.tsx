'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface GlobalCategoryBarProps {
    data: { category: string; count: number }[]
}

export function GlobalCategoryBar({ data }: GlobalCategoryBarProps) {
    const total = data.reduce((s, d) => s + d.count, 0)
    const max = Math.max(...data.map(d => d.count), 1)

    // Color palette for each category (same order as RSS_CATEGORIES)
    const colors: Record<string, string> = {
        'IT': 'bg-primary',
        'スポーツ': 'bg-emerald-500',
        'エンターテイメント': 'bg-violet-500',
        '地方・地域': 'bg-amber-500',
        '訃報・人事': 'bg-slate-500',
        'サイエンス': 'bg-cyan-500',
        '中国・韓国': 'bg-rose-500',
        'その他': 'bg-slate-600',
    }

    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">記事母集団 (過去30日)</CardTitle>
                <CardDescription>収集された全記事のジャンル分布 — 合計 {total.toLocaleString()} 件</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    {data.map(({ category, count }) => {
                        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
                        const barWidth = max > 0 ? (count / max) * 100 : 0
                        const color = colors[category] ?? 'bg-slate-500'
                        return (
                            <div key={category} className="flex items-center gap-3">
                                <div className="w-20 shrink-0 text-right text-xs text-muted-foreground truncate">
                                    {category}
                                </div>
                                <div className="flex-1 bg-card rounded-full h-5 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${color} opacity-70 transition-all duration-500`}
                                        style={{ width: `${barWidth}%` }}
                                    />
                                </div>
                                <div className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums">
                                    {count.toLocaleString()} 件
                                    <span className="text-muted-foreground/70 ml-1">({pct}%)</span>
                                </div>
                            </div>
                        )
                    })}
                    {data.every(d => d.count === 0) && (
                        <p className="text-sm text-muted-foreground text-center py-4">データがありません</p>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
