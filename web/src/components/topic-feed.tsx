'use client'

// トピック別ビュー — 新聞の紙面のようにジャンルごとのセクションで見せる。
// 偏食予防の仕掛け:
//   1. セクションの並び順は訪問ごとにシャッフル（固定順だと上のジャンルばかり読んでしまう）
//   2. 各セクションの最後の1枠は「セレンディピティ枠🎲」= 注目順の上位圏外からランダム抽出
// 並びのシャッフルは訪問中は安定（再レンダリングで踊らないよう、シードを保持する）。

import { useMemo, useRef } from 'react'
import Link from 'next/link'
import { ArrowRight, Shuffle } from 'lucide-react'
import { NewsGrid } from '@/components/news-grid'
import { PackArticle } from '@/lib/client/types'
import { buildTopicSections } from '@/lib/client/engine'

/** シード付き乱数（mulberry32）: 訪問中はシャッフル順を安定させる */
function mulberry32(seed: number) {
    return () => {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function seededShuffle<T>(items: T[], seed: number): T[] {
    const rand = mulberry32(seed)
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

export function TopicFeed({ articles, seenIds, dismissedIds, onCategoryClick }: {
    articles: PackArticle[]
    seenIds: Set<string>
    dismissedIds: Set<string>
    onCategoryClick?: (category: string) => void
}) {
    // 訪問ごとに1回だけ決まるシード（再レンダリングでは変わらない）
    const seedRef = useRef<number | null>(null)
    if (seedRef.current === null) seedRef.current = Math.floor(Math.random() * 0xffffffff)

    const sections = useMemo(() => {
        const built = buildTopicSections(articles, seenIds, dismissedIds)
        return seededShuffle(built, seedRef.current!)
    }, [articles, seenIds, dismissedIds])

    if (sections.length === 0) {
        return (
            <div className="text-center py-10 text-sm text-muted-foreground bg-card border border-dashed border-border rounded-xl">
                表示できる記事が見つかりませんでした
            </div>
        )
    }

    return (
        <div className="space-y-7">
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80 px-0.5">
                <Shuffle className="w-3 h-3" />
                トピックの並び順は訪問ごとに入れ替わります。🎲は注目順ではなくランダムに選ばれた記事です（偏食予防）。
            </p>
            {sections.map(sec => (
                <section key={sec.category}>
                    <div className="flex items-baseline gap-2 mb-2 px-0.5">
                        <span className="w-2 h-2 rounded-full bg-primary self-center" />
                        <h2 className="text-[13px] font-bold">{sec.category}</h2>
                        <span className="text-[11px] text-muted-foreground tnum">{sec.total}件</span>
                        <Link
                            href={`/?category=${encodeURIComponent(sec.category)}`}
                            className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                        >
                            もっと見る<ArrowRight className="w-3 h-3" />
                        </Link>
                    </div>
                    <NewsGrid
                        articles={sec.articles}
                        onCategoryClick={onCategoryClick}
                        withFeatured={false}
                    />
                </section>
            ))}
        </div>
    )
}
