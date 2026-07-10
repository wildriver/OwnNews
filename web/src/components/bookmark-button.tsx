'use client'

// 記事のストック（あとで読む）トグルボタン。
// interaction基盤（bookmark型）に乗るため、履歴ページの「ストック」タブと
// 端末間同期がそのまま機能する。

import { useState, useEffect } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { toast } from 'sonner'
import { isBookmarked, toggleBookmark } from '@/lib/client/interactions'

export function BookmarkButton({ articleId }: { articleId: string }) {
    const [on, setOn] = useState<boolean | null>(null)  // null=読み込み中

    useEffect(() => {
        let cancelled = false
        setOn(null)
        isBookmarked(articleId).then(b => { if (!cancelled) setOn(b) }).catch(() => { if (!cancelled) setOn(false) })
        return () => { cancelled = true }
    }, [articleId])

    const onClick = () => {
        if (on === null) return
        const next = !on
        setOn(next)  // 楽観更新
        toggleBookmark(articleId, next)
            .then(() => {
                if (next) toast.success('ストックしました', { description: '履歴ページの「ストック」から読み返せます' })
            })
            .catch(() => setOn(!next))
    }

    return (
        <button
            onClick={onClick}
            disabled={on === null}
            aria-pressed={on === true}
            title={on ? 'ストックから外す' : 'あとで読む・取っておく'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${on
                ? 'bg-accent border-primary/40 text-primary'
                : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
        >
            {on ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
            {on ? 'ストック済み' : 'ストック'}
        </button>
    )
}
