'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useCallback } from 'react'
import { NewsGrid } from '@/components/news-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X, Loader2 } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

const PAGE_SIZE = 20

interface NewsFeedClientProps {
  articles: GroupedArticle[]
  selectedCategory?: string | null
}

export function NewsFeedClient({ articles: initialArticles, selectedCategory }: NewsFeedClientProps) {
  const router = useRouter()
  const [articles, setArticles] = useState<GroupedArticle[]>(initialArticles)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [offset, setOffset] = useState(initialArticles.length)
  const loaderRef = useRef<HTMLDivElement>(null)

  // Reset when initial data changes (e.g. category filter applied)
  useEffect(() => {
    setArticles(initialArticles)
    setOffset(initialArticles.length)
    setHasMore(initialArticles.length >= PAGE_SIZE)
  }, [initialArticles])

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE_SIZE),
      })
      if (selectedCategory) params.set('category', selectedCategory)

      const res = await fetch(`/api/articles?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      if (!data.hasMore || !data.articles?.length) setHasMore(false)

      if (data.articles?.length > 0) {
        setArticles(prev => {
          const ids = new Set(prev.map((a) => a.id))
          return [...prev, ...data.articles.filter((a: GroupedArticle) => !ids.has(a.id))]
        })
        setOffset(prev => prev + data.articles.length)
      }
    } catch (e) {
      console.error('loadMore error', e)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }, [loading, hasMore, offset, selectedCategory])

  // IntersectionObserver — trigger load when sentinel enters viewport
  useEffect(() => {
    const el = loaderRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [loadMore])

  return (
    <div>
      {selectedCategory && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-400">ジャンルフィルタ:</span>
          <Badge className="bg-sky-500/20 text-sky-300 border border-sky-500/40 px-2 py-0.5">
            {selectedCategory}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-slate-400 hover:text-white hover:bg-white/10"
            onClick={() => router.push('/')}
          >
            <X className="h-3 w-3 mr-1" />
            解除
          </Button>
          <span className="text-xs text-slate-500 ml-1">{articles.length} 件表示中</span>
        </div>
      )}

      <NewsGrid
        articles={articles}
        onCategoryClick={(cat) => router.push(`/?category=${encodeURIComponent(cat)}`)}
      />

      {/* Infinite scroll sentinel */}
      <div ref={loaderRef} className="flex justify-center py-10">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-slate-600" />}
        {!loading && !hasMore && articles.length > 0 && (
          <p className="text-xs text-slate-700">― すべて読み込み済み ―</p>
        )}
      </div>
    </div>
  )
}
