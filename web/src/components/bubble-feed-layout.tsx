'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect, useRef, useMemo } from 'react'
import { NewsGrid } from '@/components/news-grid'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

const PAGE_SIZE = 24     // リストモードの1ページ
const OUT_PAGE = 12      // バブル外の追加読み込み単位

/** ローダーがビューポート下端から何px以内に入ったら追加読込するか */
const REVEAL_MARGIN = 600

/**
 * 無限スクロールで少しずつ表示件数を増やすフック。
 *
 * IntersectionObserverは使わない。理由:
 *  - IOは「交差状態の変化」でしか発火しないため、追加読込後もローダーが画面内に
 *    留まると二度と発火せずデッドロックする（初期表示がほぼ画面に収まりスクロール量が
 *    小さいときに顕在化。リサイズで交差が再計算されると復帰、という報告と一致）。
 *  - 一部の環境（バックグラウンドタブ等）ではIO自体が抑制され発火しないことがある。
 *
 * 代わりに「ローダーの位置をscroll/resizeと各描画後に直接測る」方式にする:
 *  - 依存配列に count を含め、1めくりごとに再チェック → まだ画面下端付近にあれば
 *    続けて読み込み、ローダーが画面外へ押し出されるまで自然にループ（短いページの
 *    自動充填＝デッドロック解消）。
 *  - scroll は capture:true で登録し、内側スクロールコンテナ（main等）のスクロールも拾う。
 */
function useInfiniteReveal(total: number, step: number, initial: number, resetKey: unknown) {
  const [count, setCount] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)

  // データ差し替え・初期値変更で先頭に戻す
  useEffect(() => { setCount(initial) }, [resetKey, initial])

  useEffect(() => {
    if (count >= total) return
    let raf = 0
    const check = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const vh = window.innerHeight || document.documentElement.clientHeight
      if (el.getBoundingClientRect().top <= vh + REVEAL_MARGIN) {
        setCount(c => Math.min(c + step, total))
      }
    }
    const onScrollOrResize = () => { if (!raf) raf = requestAnimationFrame(check) }
    // 初期＆内容変化時に直接判定（rAFのスロットリングに依存せず自動充填・デッドロック解消）
    check()
    window.addEventListener('scroll', onScrollOrResize, true)  // capture=内側コンテナも拾う
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [total, step, count])

  return { count, ref, hasMore: count < total }
}

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
  const { count: visibleCount, ref: loaderRef } = useInfiniteReveal(
    fallbackArticles.length, PAGE_SIZE, PAGE_SIZE, fallbackArticles
  )
  const visibleFallback = useMemo(() => fallbackArticles.slice(0, visibleCount), [fallbackArticles, visibleCount])

  // ---- バブル外ゾーンの無限スクロール ----
  // 初期表示数は「視野の広さ」スライダー由来。以降スクロールで増える。
  const outInitial = Math.max(6, Math.round(OUT_PAGE * 2 * filterStrength))
  const { count: outVisible, ref: outLoaderRef, hasMore: outHasMore } = useInfiniteReveal(
    outBubbleArticles.length, OUT_PAGE, outInitial, outBubbleArticles
  )
  const visibleOut = useMemo(() => outBubbleArticles.slice(0, outVisible), [outBubbleArticles, outVisible])

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
