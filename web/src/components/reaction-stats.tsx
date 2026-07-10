'use client'

// ダッシュボード: リアクションの統計。
//   1. みんなの感情 — サイト全体のリアクション分布（匿名集計RPC、過去30日）
//   2. あなたの意見バランス — 自分が押した賛成/反対の比率（エコーチェンバー度の入口）
// どちらも取得に失敗したらセクションごと非表示（ダッシュボードを妨げない）。

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { getUserEmail } from '@/lib/client/sync'
import { REACTIONS } from '@/lib/client/reactions'

interface Stats {
    global: Record<string, number>
    mine: Record<string, number>
}

export function ReactionStats() {
    const [stats, setStats] = useState<Stats | null>(null)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const email = await getUserEmail()
            if (!email) return
            const supabase = createClient()
            const [globalRes, mineRes] = await Promise.all([
                supabase.rpc('global_reaction_counts', { days: 30 }),
                supabase.from('article_reactions').select('reaction').eq('user_id', email),
            ])
            if (cancelled || globalRes.error || mineRes.error) return
            const global: Record<string, number> = {}
            for (const r of (globalRes.data ?? []) as { reaction: string; cnt: number }[]) {
                global[r.reaction] = Number(r.cnt)
            }
            const mine: Record<string, number> = {}
            for (const r of (mineRes.data ?? []) as { reaction: string }[]) {
                mine[r.reaction] = (mine[r.reaction] ?? 0) + 1
            }
            setStats({ global, mine })
        }
        load()
        return () => { cancelled = true }
    }, [])

    // データ未取得・全ゼロなら何も出さない
    if (!stats) return null
    const globalTotal = Object.values(stats.global).reduce((s, n) => s + n, 0)
    if (globalTotal === 0) return null

    const globalMax = Math.max(...REACTIONS.map(r => stats.global[r.key] ?? 0), 1)
    const agree = stats.mine['agree'] ?? 0
    const disagree = stats.mine['disagree'] ?? 0
    const opinionTotal = agree + disagree
    const agreePct = opinionTotal > 0 ? Math.round((agree / opinionTotal) * 100) : 0

    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">みんなの感情</CardTitle>
                <CardDescription>全ユーザーのリアクション分布（過去30日・匿名集計）</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* 全体分布 */}
                <div className="space-y-2.5">
                    {REACTIONS.map(r => {
                        const n = stats.global[r.key] ?? 0
                        const pct = globalTotal > 0 ? ((n / globalTotal) * 100).toFixed(0) : '0'
                        return (
                            <div key={r.key} className="flex items-center gap-3">
                                <div className="w-28 shrink-0 text-right text-xs text-muted-foreground truncate">
                                    {r.emoji} {r.label}
                                </div>
                                <div className="flex-1 bg-secondary rounded-full h-4 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-primary opacity-75 transition-all duration-500"
                                        style={{ width: `${(n / globalMax) * 100}%` }}
                                    />
                                </div>
                                <div className="w-16 shrink-0 text-xs text-muted-foreground tnum">
                                    {n} <span className="text-muted-foreground/60">({pct}%)</span>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* 自分の意見バランス */}
                {opinionTotal >= 3 && (
                    <div className="pt-4 border-t border-border">
                        <div className="text-[13px] font-semibold mb-1">あなたの意見バランス</div>
                        <p className="text-[11px] text-muted-foreground mb-2">
                            賛成と反対の比率。賛成ばかりなら「同意できる記事だけを読んでいる」サインかもしれません。
                        </p>
                        <div className="flex h-5 rounded-full overflow-hidden border border-border">
                            {agree > 0 && (
                                <div className="bg-primary/70 flex items-center justify-center text-[10px] text-white tnum"
                                    style={{ width: `${agreePct}%` }}>
                                    {agreePct >= 15 && `🙆 ${agreePct}%`}
                                </div>
                            )}
                            {disagree > 0 && (
                                <div className="bg-rose-400 flex items-center justify-center text-[10px] text-white tnum"
                                    style={{ width: `${100 - agreePct}%` }}>
                                    {100 - agreePct >= 15 && `🙅 ${100 - agreePct}%`}
                                </div>
                            )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 tnum">
                            賛成 {agree} / 反対 {disagree}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
