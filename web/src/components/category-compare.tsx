'use client'

// あなた vs 全体 — ジャンル分布の乖離。
// 「平均からの乖離を情報的健康の観点で提示したい」に応える。
// 全体側は記事パックの匿名閲覧集計（views）をジャンル別に合算したもの
// （=OwnNews利用者全体が何をどれだけ読んでいるか）。端末内で計算・通信ゼロ。
// 右に伸びる=あなたが平均より多く読むジャンル、左=少ないジャンル。

import Link from 'next/link'
import { Scale } from 'lucide-react'
import { PackArticle } from '@/lib/client/types'

const MIN_MY_TOTAL = 5     // 自分の閲覧が少なすぎる間は比較しない
const MAX_ROWS = 8

function primaryCat(cat?: string): string {
    const c = (cat || '').split(',')[0].trim()
    return c && c !== 'その他' ? c : ''
}

export function CategoryCompare({ articles, myDistribution }: {
    articles: PackArticle[]
    myDistribution: Record<string, number>
}) {
    // 全体: パックの匿名閲覧数をジャンル別に集計してシェア化
    const globalCounts = new Map<string, number>()
    for (const a of articles) {
        const c = primaryCat(a.category)
        if (!c || !a.views) continue
        globalCounts.set(c, (globalCounts.get(c) ?? 0) + a.views)
    }
    const globalTotal = [...globalCounts.values()].reduce((s, n) => s + n, 0)

    // 自分: 閲覧履歴のジャンル分布をシェア化
    const myTotal = Object.values(myDistribution).reduce((s, n) => s + n, 0)

    if (globalTotal < 10 || myTotal < MIN_MY_TOTAL) return null  // シグナル不足時は出さない

    // 比較行: 全体シェアの大きい順に上位を採用
    const rows = [...globalCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ROWS)
        .map(([cat, gv]) => {
            const globalShare = gv / globalTotal
            const myShare = (myDistribution[cat] ?? 0) / myTotal
            return { cat, globalShare, myShare, diff: myShare - globalShare }
        })

    const maxAbs = Math.max(...rows.map(r => Math.abs(r.diff)), 0.05)

    return (
        <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Scale className="w-5 h-5 text-primary" />あなた vs 全体
            </h3>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-4">
                OwnNews利用者全体の読まれ方（匿名集計）と、あなたの閲覧の差。
                右＝平均より多く読むジャンル、左＝少ないジャンル。タップでそのジャンルへ。
            </p>
            <div className="space-y-2">
                {rows.map(r => {
                    const pct = Math.round(r.diff * 100)
                    const w = Math.abs(r.diff) / maxAbs * 50   // 中央から最大50%
                    return (
                        <Link
                            key={r.cat}
                            href={`/?category=${encodeURIComponent(r.cat)}`}
                            className="group flex items-center gap-3 hover:bg-secondary/40 -mx-2 px-2 py-0.5 rounded-md transition-colors"
                        >
                            <div className="w-20 shrink-0 text-right text-[11px] text-muted-foreground group-hover:text-foreground">
                                {r.cat}
                            </div>
                            <div className="flex-1 relative h-4">
                                {/* 中央線 */}
                                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                                {r.diff >= 0 ? (
                                    <div
                                        className="absolute left-1/2 top-0.5 bottom-0.5 rounded-r-full bg-primary/70"
                                        style={{ width: `${w}%` }}
                                    />
                                ) : (
                                    <div
                                        className="absolute top-0.5 bottom-0.5 rounded-l-full bg-amber-500/70"
                                        style={{ right: '50%', width: `${w}%` }}
                                    />
                                )}
                            </div>
                            <div className={`w-14 shrink-0 text-[11px] tnum text-right ${pct > 0 ? 'text-primary' : pct < 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                {pct > 0 ? '+' : ''}{pct}pt
                            </div>
                        </Link>
                    )
                })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">
                左に大きいジャンル＝「みんなは読んでいるのに、あなたはあまり読んでいない」領域です
            </p>
        </div>
    )
}
