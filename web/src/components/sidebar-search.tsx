'use client'

// サイドバーのキーワード検索 + 話題のキーワード（タグクラウド）。
// 検索は /?q= の検索モードに飛ばすだけで、絞り込み自体は端末内（LocalFeed）で行う。
// 話題のキーワードは端末にキャッシュ済みの記事パックから抽出する（サーバ問い合わせなし）。
// 意図的にランキング表示にはせず、毎回シャッフルして「いま話題の言葉」として見せる。

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Search, Flame } from 'lucide-react'
import { getAllArticles } from '@/lib/client/store'
import { hotKeywords } from '@/lib/client/engine'

export function SidebarSearch() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const current = searchParams.get('q') || ''
    const [q, setQ] = useState(current)
    const [hot, setHot] = useState<string[]>([])

    // 検索モードの出入り（チップから遷移・×で解除）に入力欄を追従させる
    useEffect(() => { setQ(current) }, [current])

    useEffect(() => {
        let cancelled = false
        getAllArticles().then(arts => {
            if (cancelled) return
            const tags = hotKeywords(arts, 10)
            for (let i = tags.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1))
                ;[tags[i], tags[j]] = [tags[j], tags[i]]
            }
            setHot(tags)
        }).catch(() => { /* IndexedDB未対応環境では非表示 */ })
        return () => { cancelled = true }
    }, [])

    const submit = (e: React.FormEvent) => {
        e.preventDefault()
        const query = q.trim()
        if (query) router.push(`/?q=${encodeURIComponent(query)}`)
    }

    return (
        <div className="px-1 space-y-3">
            <form onSubmit={submit} role="search" className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                    type="search"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="キーワード検索"
                    aria-label="記事をキーワード検索"
                    className="w-full h-8 pl-8 pr-2 rounded-lg bg-card border border-border text-[12px] placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/50"
                />
            </form>

            {hot.length > 0 && (
                <div>
                    <h3 className="text-[10px] font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                        <Flame className="w-3 h-3" />
                        話題のキーワード
                    </h3>
                    <div className="flex flex-wrap gap-1">
                        {hot.map(tag => (
                            <Link
                                key={tag}
                                href={`/?q=${encodeURIComponent(tag)}`}
                                className="text-[10px] px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded border border-border hover:text-primary hover:border-primary/40 transition-colors"
                            >
                                {tag}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
