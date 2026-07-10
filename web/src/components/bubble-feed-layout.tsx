'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useMemo } from 'react'
import { NewsGrid } from '@/components/news-grid'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

const PAGE_SIZE = 24     // リストモードの1ページ
const OUT_PAGE = 12      // バブル外の追加読み込み単位

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
  const onCategoryClick = (cat: string) => router.push(`/?category=${encodeURIComponent(cat)}`)

  // ---- リストモード（カテゴリ/日付フィルタ・冷スタート）の無限スクロール ----
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loaderRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [fallbackArticles])
  const visibleFallback = useMemo(() => fallbackArticles.slice(0, visibleCount), [fallbackArticles, visibleCount])
  useEffect(() => {
    const el = loaderRef.current
    if (!el) return
    const ob = new IntersectionObserver(
      e => { if (e[0].isIntersecting) setVisibleCount(c => Math.min(c + PAGE_SIZE, fallbackArticles.length)) },
      { rootMargin: '600px' }
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [fallbackArticles.length])

  // ---- バブル外ゾーンの無限スクロール ----
  // 初期表示数は「視野の広さ」スライダー由来。以降スクロールで増える。
  const outInitial = Math.max(6, Math.round(OUT_PAGE * 2 * filterStrength))
  const [outVisible, setOutVisible] = useState(outInitial)
  const outLoaderRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setOutVisible(outInitial) }, [outBubbleArticles, outInitial])
  const visibleOut = useMemo(() => outBubbleArticles.slice(0, outVisible), [outBubbleArticles, outVisible])
  const outHasMore = outVisible < outBubbleArticles.length
  useEffect(() => {
    const el = outLoaderRef.current
    if (!el) return
    const ob = new IntersectionObserver(
      e => { if (e[0].isIntersecting) setOutVisible(c => Math.min(c + OUT_PAGE, outBubbleArticles.length)) },
      { rootMargin: '600px' }
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [outBubbleArticles.length])

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
              あなたの関心に近い話題
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

        {/* バブル外ゾーン（いろいろなジャンル・無限スクロール） */}
        <section>
          <div className="flex items-baseline gap-2 mb-2 px-0.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 self-center" />
            <h2 className="text-[13px] font-bold">いろいろなニュース</h2>
            <span className="text-[11px] text-muted-foreground tnum">{outBubbleArticles.length}件</span>
            <span className="text-[10px] text-muted-foreground/70 ml-auto hidden sm:block">
              バブルの外 — 全ジャンルから均等に
            </span>
          </div>

          {outBubbleArticles.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-muted-foreground bg-card border border-dashed border-border rounded-xl">
              表示できる記事が見つかりませんでした
            </div>
          ) : (
            <>
              <NewsGrid articles={visibleOut} outsideBubble onCategoryClick={onCategoryClick} withFeatured={false} />
              <div ref={outLoaderRef} className="flex justify-center py-6">
                {!outHasMore && (
                  <p className="text-[11px] text-muted-foreground/60">― すべて表示しました ―</p>
                )}
              </div>
            </>
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
        {visibleCount >= fallbackArticles.length && visibleFallback.length > 0 && (
          <p className="text-[11px] text-muted-foreground/60">― すべて表示しました ―</p>
        )}
      </div>
    </div>
  )
}
