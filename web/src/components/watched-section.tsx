'use client'

// トップの「📌 ウォッチ中」専用枠。
// 購読タグに合致する未読記事を新着順で必ず見える位置に表示する
// （情報的健康の能動面:「まんべんなく」に加えて「確実に見たい」の保証）。
// タグチップのタップでその場で解除できる。ジャンル非表示設定より優先。

import { useState, useEffect, useMemo } from 'react'
import { Pin, X } from 'lucide-react'
import { toast } from 'sonner'
import { NewsGrid } from '@/components/news-grid'
import { PackArticle } from '@/lib/client/types'
import { filterWatchedArticles } from '@/lib/client/engine'
import { getWatchedTags, toggleWatchedTag, WATCHED_EVENT } from '@/lib/client/watched-tags'
import { SYNCED_EVENT } from '@/lib/client/sync'

const SHOW_MAX = 8

export function WatchedSection({ articles, seenIds, dismissedIds, onCategoryClick }: {
    articles: PackArticle[]
    seenIds: Set<string>
    dismissedIds: Set<string>
    onCategoryClick?: (category: string) => void
}) {
    const [tags, setTags] = useState<string[]>([])

    useEffect(() => {
        let cancelled = false
        const load = () => getWatchedTags().then(t => { if (!cancelled) setTags(t) })
        load()
        window.addEventListener(WATCHED_EVENT, load)
        window.addEventListener(SYNCED_EVENT, load)   // 他端末での購読変更を反映
        return () => {
            cancelled = true
            window.removeEventListener(WATCHED_EVENT, load)
            window.removeEventListener(SYNCED_EVENT, load)
        }
    }, [])

    const matched = useMemo(
        () => filterWatchedArticles(articles, tags, seenIds, dismissedIds),
        [articles, tags, seenIds, dismissedIds]
    )

    if (tags.length === 0) return null

    const remove = async (tag: string) => {
        await toggleWatchedTag(tag)
        toast.info(`「${tag}」のウォッチを解除しました`)
    }

    return (
        <section className="mb-6 rounded-xl border border-primary/25 bg-accent/40 p-3">
            <div className="flex items-center gap-2 flex-wrap mb-2 px-0.5">
                <span className="inline-flex items-center gap-1 text-[13px] font-bold">
                    <Pin className="w-3.5 h-3.5 text-primary" />ウォッチ中
                </span>
                {tags.map(tag => (
                    <button
                        key={tag}
                        onClick={() => remove(tag)}
                        title="タップでウォッチ解除"
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary text-primary-foreground hover:opacity-80 transition-opacity cursor-pointer"
                    >
                        {tag}
                        <X className="w-3 h-3" />
                    </button>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground hidden sm:block">
                    タグを含む記事を必ずここに表示（記事のキーワードや検索から追加）
                </span>
            </div>
            {matched.length === 0 ? (
                <p className="text-[12px] text-muted-foreground px-0.5 py-2">いまウォッチ中のタグの新着はありません</p>
            ) : (
                <NewsGrid articles={matched.slice(0, SHOW_MAX)} onCategoryClick={onCategoryClick} withFeatured={false} />
            )}
        </section>
    )
}
