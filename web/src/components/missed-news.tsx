'use client'

// 「みんなが読んでいて、あなたがまだ読んでいない」ニュース。
// 記事パックに焼き込まれた匿名の閲覧数・リアクション集計（世間の窓と同じシグナル）と、
// 端末内の閲覧履歴を突き合わせて計算する。通信ゼロ・完全ローカル。
// 情報的健康の文脈: 世間の共通話題を見落としているかどうかの気づきを与える。

import Link from 'next/link'
import { Telescope, Eye } from 'lucide-react'
import { PackArticle, LocalInteraction } from '@/lib/client/types'
import { REACTION_EMOJI } from '@/lib/client/reactions'
import { extractSourceName } from '@/lib/news'

const MAX_ITEMS = 8

function socialScore(a: PackArticle): number {
    const reacts = a.reactions ? Object.values(a.reactions).reduce((s, n) => s + n, 0) : 0
    return (a.views ?? 0) + reacts * 3
}

export function MissedNews({ articles, interactions }: {
    articles: PackArticle[]
    interactions: LocalInteraction[]
}) {
    const seen = new Set(interactions.map(i => i.article_id))
    const missed = articles
        .filter(a => !seen.has(a.id) && socialScore(a) > 0)
        .sort((x, y) => socialScore(y) - socialScore(x))
        .slice(0, MAX_ITEMS)

    if (missed.length === 0) return null  // シグナルが無い間は出さない（誤解を招く空欄より非表示）

    return (
        <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Telescope className="w-5 h-5 text-amber-500" />見落としているかも
            </h3>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
                多くの人が読んでいるのに、あなたがまだ読んでいないニュース（匿名集計・端末内で計算）
            </p>
            <div className="divide-y divide-border">
                {missed.map(a => {
                    const topReacts = a.reactions
                        ? Object.entries(a.reactions).sort((x, y) => y[1] - x[1]).slice(0, 2)
                        : []
                    return (
                        <Link
                            key={a.id}
                            href={`/article/${a.id}`}
                            className="group flex items-center gap-3 py-2 hover:bg-secondary/50 -mx-2 px-2 rounded-md transition-colors"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium leading-snug line-clamp-1 group-hover:text-primary transition-colors">
                                    {a.title}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                    {(a.category || '').split(',')[0]} · {a.source || extractSourceName(a.link)}
                                </div>
                            </div>
                            <div className="shrink-0 flex items-center gap-2 text-[11px] text-muted-foreground tnum">
                                {topReacts.map(([k, n]) => (
                                    <span key={k}>{REACTION_EMOJI[k] ?? ''}{n}</span>
                                ))}
                                <span className="inline-flex items-center gap-0.5">
                                    <Eye className="w-3 h-3" />{a.views ?? 0}
                                </span>
                            </div>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}
