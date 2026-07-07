'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useMemo } from 'react'
import { NewsGrid } from '@/components/news-grid'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

const PAGE_SIZE = 24

interface BubbleFeedLayoutProps {
  inBubbleArticles: GroupedArticle[]
  outBubbleArticles: GroupedArticle[]
  /** フィルタモード（カテゴリ/日付指定時）の全記事。ページングはローカルで行う */
  fallbackArticles: GroupedArticle[]
  bubbleMode: 'vector' | 'none'
  filterStrength: number
  selectedCategory?: string | null
}

// 表示専用レイアウト。データ取得・除外フィルタはLocalFeed側で完結しており、
// ここではサーバへのリクエストは一切発生しない（ページングもローカル）。
export function BubbleFeedLayout({
  inBubbleArticles,
  outBubbleArticles,
  fallbackArticles,
  bubbleMode,
  filterStrength,
  selectedCategory,
}: BubbleFeedLayoutProps) {
  const router = useRouter()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loaderRef = useRef<HTMLDivElement>(null)

  // フィルタ条件が変わったらページングをリセット
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [fallbackArticles])

  const visibleFallback = useMemo(
    () => fallbackArticles.slice(0, visibleCount),
    [fallbackArticles, visibleCount]
  )
  const hasMore = visibleCount < fallbackArticles.length

  useEffect(() => {
    const el = loaderRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          setVisibleCount(c => Math.min(c + PAGE_SIZE, fallbackArticles.length))
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [fallbackArticles.length])

  const onCategoryClick = (cat: string) => router.push(`/?category=${encodeURIComponent(cat)}`)

  // ---- バブルモード ----
  if (bubbleMode === 'vector') {
    return (
      <div className="space-y-6">
        {/* バブル内ゾーン */}
        <section>
          <div className="flex items-baseline gap-2 mb-2 px-0.5">
            <span className="w-2 h-2 rounded-full bg-primary self-center" />
            <h2 className="text-[13px] font-bold">あなたのバブル</h2>
            <span className="text-[11px] text-muted-foreground tnum">{inBubbleArticles.length}件</span>
            <span className="text-[10px] text-muted-foreground/70 ml-auto hidden sm:block">
              関心ベクトルとの類似度で選出
            </span>
          </div>

          {inBubbleArticles.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground bg-card border border-dashed border-border rounded-xl">
              記事を読み続けると、あなたのバブルが形成されます
            </div>
          ) : (
            <NewsGrid articles={inBubbleArticles} onCategoryClick={onCategoryClick} />
          )}
        </section>

        {/* バブル外ゾーン */}
        <section>
          <div className="flex items-baseline gap-2 mb-2 px-0.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 self-center" />
            <h2 className="text-[13px] font-bold">バブルの外</h2>
            <span className="text-[11px] text-muted-foreground tnum">{outBubbleArticles.length}件</span>
            <span className="text-[10px] text-muted-foreground/70 ml-auto hidden sm:block">
              普段読まない話題 — 視野を広げる
            </span>
          </div>

          {outBubbleArticles.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-muted-foreground bg-card border border-dashed border-border rounded-xl">
              {filterStrength === 0
                ? '「視野の広さ」スライダーを右に動かすと、バブル外の記事が表示されます'
                : 'バブル外の記事が見つかりませんでした'}
            </div>
          ) : (
            <NewsGrid articles={outBubbleArticles} outsideBubble onCategoryClick={onCategoryClick} />
          )}
        </section>
      </div>
    )
  }

  // ---- リストモード（カテゴリ/日付フィルタ・冷スタート） ----
  return (
    <div>
      {selectedCategory && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted-foreground">ジャンル:</span>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-foreground bg-accent rounded-full pl-2.5 pr-1 py-0.5">
            {selectedCategory}
            <Button
              variant="ghost" size="icon"
              className="h-4 w-4 rounded-full hover:bg-black/10"
              onClick={() => router.push('/')}
            >
              <X className="h-3 w-3" />
            </Button>
          </span>
          <span className="text-[11px] text-muted-foreground tnum">{fallbackArticles.length}件</span>
        </div>
      )}

      <NewsGrid articles={visibleFallback} onCategoryClick={onCategoryClick} />

      <div ref={loaderRef} className="flex justify-center py-8">
        {!hasMore && visibleFallback.length > 0 && (
          <p className="text-[11px] text-muted-foreground/60">― すべて表示しました ―</p>
        )}
      </div>
    </div>
  )
}
