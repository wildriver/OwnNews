'use client'

// 記事への1タップリアクション（GitHubリアクション風）。
// 複数選択可・トグル式。自分が押したものはハイライト、件数は匿名集計。
// 楽観更新し、サーバー失敗時は巻き戻す。

import { useState, useEffect } from 'react'
import { REACTIONS, ReactionKey, fetchReactions, toggleReaction } from '@/lib/client/reactions'

export function ReactionBar({ articleId }: { articleId: string }) {
    const [counts, setCounts] = useState<Record<string, number>>({})
    const [mine, setMine] = useState<Set<ReactionKey>>(new Set())
    const [ready, setReady] = useState(false)

    useEffect(() => {
        let cancelled = false
        setReady(false)
        setCounts({})
        setMine(new Set())
        fetchReactions(articleId).then(s => {
            if (cancelled) return
            if (s) {
                setCounts(s.counts)
                setMine(s.mine)
            }
            // 取得に失敗してもボタンは押せる状態にする（書き込みはDB側で重複排除される）
            setReady(true)
        }).catch(() => { if (!cancelled) setReady(true) })
        return () => { cancelled = true }
    }, [articleId])

    const onToggle = (key: ReactionKey) => {
        const wasOn = mine.has(key)
        // 楽観更新
        const nextMine = new Set(mine)
        if (wasOn) nextMine.delete(key); else nextMine.add(key)
        setMine(nextMine)
        setCounts(c => ({ ...c, [key]: Math.max(0, (c[key] ?? 0) + (wasOn ? -1 : 1)) }))
        toggleReaction(articleId, key, !wasOn).then(ok => {
            if (ok) return
            // 失敗: 巻き戻し
            setMine(m => {
                const back = new Set(m)
                if (wasOn) back.add(key); else back.delete(key)
                return back
            })
            setCounts(c => ({ ...c, [key]: Math.max(0, (c[key] ?? 0) + (wasOn ? 1 : -1)) }))
        })
    }

    return (
        <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-xl font-bold text-foreground mb-1">この記事への反応</h2>
            <p className="text-[12px] text-muted-foreground mb-4">
                あなたの受け止めをワンタップで。集計は匿名で、推薦には影響しません。
            </p>
            <div className="flex flex-wrap gap-2">
                {REACTIONS.map(r => {
                    const active = mine.has(r.key)
                    const n = counts[r.key] ?? 0
                    return (
                        <button
                            key={r.key}
                            onClick={() => onToggle(r.key)}
                            disabled={!ready}
                            title={r.hint}
                            aria-pressed={active}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:opacity-50 ${active
                                ? 'bg-accent border-primary/40 text-accent-foreground'
                                : 'bg-background border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
                                }`}
                        >
                            <span aria-hidden>{r.emoji}</span>
                            {r.label}
                            {n > 0 && (
                                <span className={`tnum text-[11px] ${active ? 'text-primary font-semibold' : 'text-muted-foreground/70'}`}>
                                    {n}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
