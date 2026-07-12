'use client'

// 記事キーワードのウォッチ切替チップ（記事詳細で使用）。
// タップで購読（📌・トップに専用枠）、もう一度タップで解除。

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { getWatchedTags, toggleWatchedTag, WATCHED_EVENT } from '@/lib/client/watched-tags'

export function WatchTagChip({ tag }: { tag: string }) {
    const [watched, setWatched] = useState(false)

    useEffect(() => {
        let cancelled = false
        const load = () => getWatchedTags().then(tags => { if (!cancelled) setWatched(tags.includes(tag)) })
        load()
        window.addEventListener(WATCHED_EVENT, load)
        return () => { cancelled = true; window.removeEventListener(WATCHED_EVENT, load) }
    }, [tag])

    const onClick = async () => {
        const { watched: now } = await toggleWatchedTag(tag)
        setWatched(now)
        if (now) toast.success(`「${tag}」をウォッチに追加しました`, { description: 'このタグを含む記事がトップの専用枠に表示されます' })
        else toast.info(`「${tag}」のウォッチを解除しました`)
    }

    return (
        <button
            onClick={onClick}
            aria-pressed={watched}
            title={watched ? 'タップでウォッチ解除' : 'タップでウォッチ（このタグの記事をトップに常時表示）'}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border transition-colors cursor-pointer ${watched
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'}`}
        >
            {watched ? '📌 ' : ''}{tag}
        </button>
    )
}
