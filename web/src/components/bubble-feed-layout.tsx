'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { NewsGrid } from '@/components/news-grid'
import { CategoryFilterBar } from '@/components/category-filter-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X, Loader2 } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

const PAGE_SIZE = 20

interface BubbleFeedLayoutProps {
  inBubbleArticles: GroupedArticle[]
  outBubbleArticles: GroupedArticle[]
  fallbackArticles: GroupedArticle[]
  bubbleMode: 'vector' | 'category' | 'none'
  userTopCats: string[]
  filterStrength: number
  selectedCategory?: string | null
  dateFrom?: string | null
  dateTo?: string | null
}

export function BubbleFeedLayout({
  inBubbleArticles,
  outBubbleArticles,
  fallbackArticles,
  bubbleMode,
  userTopCats,
  filterStrength,
  selectedCategory,
  dateFrom,
  dateTo,
}: BubbleFeedLayoutProps) {
  const router = useRouter()
  const [articles, setArticles] = useState<GroupedArticle[]>(fallbackArticles)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(fallbackArticles.length >= PAGE_SIZE)
  const [offset, setOffset] = useState(fallbackArticles.length)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const loaderRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setArticles(fallbackArticles)
    setOffset(fallbackArticles.length)
    setHasMore(fallbackArticles.length >= PAGE_SIZE)
  }, [fallbackArticles])

  const visibleFallback = useMemo(() => {
    if (excluded.size === 0) return articles
    return articles.filter(a => {
      const cats = (a.category || '').split(',').map(c => c.trim()).filter(Boolean)
      return cats.some(c => !excluded.has(c)) || cats.length === 0
    })
  }, [articles, excluded])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const p = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) })
      if (selectedCategory) p.set('category', selectedCategory)
      if (dateFrom) p.set('dateFrom', dateFrom)
      if (dateTo) p.set('dateTo', dateTo)
      if (excluded.size > 0) p.set('exclude', Array.from(excluded).join(','))

      const res = await fetch(`/api/articles?${p}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data.hasMore || !data.articles?.length) setHasMore(false)
      if (data.articles?.length > 0) {
        setArticles(prev => {
          const ids = new Set(prev.map(a => a.id))
          return [...prev, ...data.articles.filter((a: GroupedArticle) => !ids.has(a.id))]
        })
        setOffset(prev => prev + data.articles.length)
      }
    } catch {
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore, offset, selectedCategory, dateFrom, dateTo, excluded])

  useEffect(() => {
    const el = loaderRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  // ---- Bubble mode ----
  if (bubbleMode !== 'none') {
    const modeLabel = bubbleMode === 'vector'
      ? '類似度ベクトル'
      : `閲覧履歴のカテゴリ（${userTopCats.slice(0, 2).join('・')}）`

    return (
      <div className="space-y-10">
        {!selectedCategory && <CategoryFilterBar onExcludeChange={setExcluded} />}

        {/* In-bubble zone */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <span className="text-lg">🫧</span>
              <h2 className="text-base font-bold text-slate-200">あなたのバブル</h2>
            </div>
            <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30 text-[10px]">
              {inBubbleArticles.length} 件
            </Badge>
            <span className="text-[10px] text-slate-600 hidden sm:block">— {modeLabel}で分類</span>
          </div>

          {inBubbleArticles.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm border border-dashed border-white/10 rounded-xl">
              記事を読み続けると、あなたのバブルが形成されます
            </div>
          ) : (
            <NewsGrid
              articles={inBubbleArticles}
              onCategoryClick={cat => router.push(`/?category=${encodeURIComponent(cat)}`)}
            />
          )}
        </section>

        {/* Out-of-bubble zone */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center gap-2">
              <span className="text-lg">🌍</span>
              <h2 className="text-base font-bold text-slate-200">バブルの外</h2>
            </div>
            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
              {outBubbleArticles.length} 件
            </Badge>
            {filterStrength === 0 && (
              <span className="text-[10px] text-slate-600">— スライダーを右に動かすと表示</span>
            )}
          </div>

          {/* Divider with explanation */}
          <div className="mb-5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/15 text-[11px] text-amber-300/70 leading-relaxed">
            ⚠ 以下はあなたが普段読まないジャンルの記事です。フィルタバブルの外側を意識的に見ることで、視野を広げることができます。
          </div>

          {outBubbleArticles.length === 0 ? (
            <div className="text-center py-10 text-slate-600 text-sm border border-dashed border-white/5 rounded-xl">
              {filterStrength === 0
                ? '上のスライダーを右に動かすと、バブル外の記事が表示されます'
                : 'バブル外の記事が見つかりませんでした'}
            </div>
          ) : (
            <NewsGrid
              articles={outBubbleArticles}
              outsideBubble
              onCategoryClick={cat => router.push(`/?category=${encodeURIComponent(cat)}`)}
            />
          )}
        </section>
      </div>
    )
  }

  // ---- Fallback mode (category filter / date filter / no data) ----
  return (
    <div>
      {!selectedCategory && <CategoryFilterBar onExcludeChange={setExcluded} />}

      {selectedCategory && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-400">ジャンルフィルタ:</span>
          <Badge className="bg-sky-500/20 text-sky-300 border border-sky-500/40 px-2 py-0.5">
            {selectedCategory}
          </Badge>
          <Button
            variant="ghost" size="sm"
            className="h-6 px-2 text-slate-400 hover:text-white hover:bg-white/10"
            onClick={() => router.push('/')}
          >
            <X className="h-3 w-3 mr-1" />解除
          </Button>
          <span className="text-xs text-slate-500 ml-1">{visibleFallback.length} 件表示中</span>
        </div>
      )}

      <NewsGrid
        articles={visibleFallback}
        onCategoryClick={cat => router.push(`/?category=${encodeURIComponent(cat)}`)}
      />

      <div ref={loaderRef} className="flex justify-center py-10">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-slate-600" />}
        {!loading && !hasMore && visibleFallback.length > 0 && (
          <p className="text-xs text-slate-700">― すべて読み込み済み ―</p>
        )}
      </div>
    </div>
  )
}
