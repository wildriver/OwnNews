'use client'

// あなたのリアクション探索。
// 「賛成を押した記事一覧に飛びたい」に応えるインタラクティブ版:
// リアクション種別チップをタップ → その記事一覧を展開 → 記事へジャンプ。
// 意見バランス（賛成:反対）も表示。全体の感情分布は重要度が低いため
// 末尾に1行へ格下げ（旧「みんなの感情」カードの縮約）。

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ThumbsUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getUserEmail } from '@/lib/client/sync'
import { REACTIONS, ReactionKey } from '@/lib/client/reactions'
import { PackArticle, LocalInteraction } from '@/lib/client/types'

interface MyReaction {
    reaction: ReactionKey
    article_id: string
    created_at: string
}

export function ReactionExplorer({ articles, interactions }: {
    articles: PackArticle[]
    interactions: LocalInteraction[]
}) {
    const [mine, setMine] = useState<MyReaction[] | null>(null)
    const [globalCounts, setGlobalCounts] = useState<Record<string, number>>({})
    const [selected, setSelected] = useState<ReactionKey | null>(null)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            const email = await getUserEmail()
            if (!email) return
            const supabase = createClient()
            const [mineRes, globalRes] = await Promise.all([
                supabase.from('article_reactions')
                    .select('reaction, article_id, created_at')
                    .eq('user_id', email)
                    .order('created_at', { ascending: false }),
                supabase.rpc('global_reaction_counts', { days: 30 }),
            ])
            if (cancelled) return
            if (!mineRes.error) setMine((mineRes.data ?? []) as MyReaction[])
            if (!globalRes.error) {
                const g: Record<string, number> = {}
                for (const r of (globalRes.data ?? []) as { reaction: string; cnt: number }[]) g[r.reaction] = Number(r.cnt)
                setGlobalCounts(g)
            }
        }
        load()
        return () => { cancelled = true }
    }, [])

    // 記事タイトルの解決: パック → 履歴スナップショットの順で引く
    const titleOf = useMemo(() => {
        const map = new Map<string, string>()
        for (const i of interactions) if (i.title) map.set(i.article_id, i.title)
        for (const a of articles) map.set(a.id, a.title)
        return map
    }, [articles, interactions])

    if (!mine || mine.length === 0) return null  // 未ログイン・リアクション0件では出さない

    const countBy = new Map<ReactionKey, number>()
    for (const r of mine) countBy.set(r.reaction, (countBy.get(r.reaction) ?? 0) + 1)

    const agree = countBy.get('agree') ?? 0
    const disagree = countBy.get('disagree') ?? 0
    const opinionTotal = agree + disagree
    const agreePct = opinionTotal > 0 ? Math.round((agree / opinionTotal) * 100) : 0

    const selectedList = selected ? mine.filter(r => r.reaction === selected).slice(0, 20) : []
    const globalTotal = Object.values(globalCounts).reduce((s, n) => s + n, 0)

    return (
        <div className="bg-card border border-border rounded-xl p-6">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <ThumbsUp className="w-5 h-5 text-primary" />あなたのリアクション
            </h3>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
                タップすると、そのリアクションを押した記事の一覧が開きます
            </p>

            {/* 種別チップ（タップで展開） */}
            <div className="flex flex-wrap gap-2">
                {REACTIONS.filter(r => (countBy.get(r.key) ?? 0) > 0).map(r => {
                    const n = countBy.get(r.key) ?? 0
                    const active = selected === r.key
                    return (
                        <button
                            key={r.key}
                            onClick={() => setSelected(active ? null : r.key)}
                            aria-pressed={active}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${active
                                ? 'bg-accent border-primary/40 text-accent-foreground'
                                : 'bg-background border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                                }`}
                        >
                            <span aria-hidden>{r.emoji}</span>{r.label}
                            <span className="tnum text-[11px]">{n}</span>
                        </button>
                    )
                })}
            </div>

            {/* 展開: 選択したリアクションの記事一覧 */}
            {selected && (
                <div className="mt-3 border border-border rounded-lg divide-y divide-border overflow-hidden">
                    {selectedList.map(r => (
                        <Link
                            key={`${r.article_id}-${r.created_at}`}
                            href={`/article/${r.article_id}`}
                            className="block px-3 py-2 text-[13px] hover:bg-secondary/60 transition-colors"
                        >
                            <span className="line-clamp-1">{titleOf.get(r.article_id) || '（タイトル不明の記事）'}</span>
                        </Link>
                    ))}
                    {selectedList.length === 0 && (
                        <p className="px-3 py-2 text-[12px] text-muted-foreground">記事が見つかりませんでした</p>
                    )}
                </div>
            )}

            {/* 意見バランス */}
            {opinionTotal >= 3 && (
                <div className="mt-4 pt-4 border-t border-border">
                    <div className="text-[12px] font-semibold mb-1">意見バランス</div>
                    <div className="flex h-4 rounded-full overflow-hidden border border-border max-w-md">
                        {agree > 0 && (
                            <div className="bg-primary/70 flex items-center justify-center text-[9px] text-white tnum" style={{ width: `${agreePct}%` }}>
                                {agreePct >= 18 && `🙆 ${agreePct}%`}
                            </div>
                        )}
                        {disagree > 0 && (
                            <div className="bg-rose-400 flex items-center justify-center text-[9px] text-white tnum" style={{ width: `${100 - agreePct}%` }}>
                                {100 - agreePct >= 18 && `🙅 ${100 - agreePct}%`}
                            </div>
                        )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        賛成ばかりなら「同意できる記事だけを読んでいる」サインかもしれません
                    </p>
                </div>
            )}

            {/* 全体の感情（縮約表示） */}
            {globalTotal > 0 && (
                <p className="mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground tnum">
                    みんなの感情（全体・30日）:{' '}
                    {REACTIONS.filter(r => (globalCounts[r.key] ?? 0) > 0)
                        .map(r => `${r.emoji}${globalCounts[r.key]}`)
                        .join('　')}
                </p>
            )}
        </div>
    )
}
