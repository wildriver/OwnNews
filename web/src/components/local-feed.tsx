'use client'

// ローカル推薦フィード
// 記事パックをIndexedDBに同期し、関心ベクトルとの類似度計算・バブル分類・
// グルーピング・スライダー応答・ジャンル除外をすべてブラウザ内で行う。
// 嗜好データは端末内（+設定時は個人Supabase）にのみ保存される。

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { BubbleFeedLayout } from '@/components/bubble-feed-layout'
import { LocalFilterSlider } from '@/components/local-filter-slider'
import { CategoryFilterBar, loadExcluded } from '@/components/category-filter-bar'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw } from 'lucide-react'
import { GroupedArticle, ONBOARDING_CATEGORIES } from '@/lib/types'
import { PackArticle } from '@/lib/client/types'
import { loadArticles } from '@/lib/client/pack'
import { rankFeed, filterArticles, seedVectorFromCategories } from '@/lib/client/engine'
import { getKV, setKV, getAllInteractions } from '@/lib/client/store'
import { syncWithPersonalDB, pushVectorToPersonalDB } from '@/lib/client/personal'
import { INTERACTION_EVENT } from '@/lib/client/interactions'

function todayLabel(): string {
    const d = new Date()
    const days = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`
}

export function LocalFeed() {
    const searchParams = useSearchParams()
    const selectedCategory = searchParams.get('category')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const [articles, setArticles] = useState<PackArticle[]>([])
    const [vector, setVector] = useState<number[] | null>(null)
    const [strength, setStrength] = useState(0.5)
    const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
    const [excluded, setExcluded] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [onboardingCats, setOnboardingCats] = useState<Set<string>>(new Set())

    // ---- 初期化: パック同期 + ローカル状態読み込み + 個人DB同期 ----
    useEffect(() => {
        let cancelled = false
        const init = async () => {
            setExcluded(loadExcluded())

            const [arts, vec, str, interactions] = await Promise.all([
                loadArticles((updated) => { if (!cancelled) setArticles(updated) }),
                getKV<number[]>('user_vector'),
                getKV<number>('filter_strength'),
                getAllInteractions(),
            ])
            if (cancelled) return

            setArticles(arts)
            setVector(vec || null)
            setStrength(str ?? 0.5)
            const seen = new Set<string>()
            const dismissed = new Set<string>()
            for (const i of interactions) {
                seen.add(i.article_id)
                if (i.type === 'not_interested') dismissed.add(i.article_id)
            }
            setSeenIds(seen)
            setDismissedIds(dismissed)
            setLoading(false)

            // 個人DBと同期（別端末の学習結果があれば取り込み）
            const remote = await syncWithPersonalDB()
            if (!cancelled && remote?.vector) {
                setVector(remote.vector)
                const s = await getKV<number>('filter_strength')
                if (s !== undefined) setStrength(s)
            }
        }
        init()
        return () => { cancelled = true }
    }, [])

    // ---- 操作イベントで既読/興味なし/ベクトルを反映 ----
    useEffect(() => {
        const handler = async (e: Event) => {
            const { articleId, type } = (e as CustomEvent).detail
            setSeenIds(prev => new Set(prev).add(articleId))
            if (type === 'not_interested') {
                setDismissedIds(prev => new Set(prev).add(articleId))
            }
            const vec = await getKV<number[]>('user_vector')
            if (vec) setVector(vec)
        }
        window.addEventListener(INTERACTION_EVENT, handler)
        return () => window.removeEventListener(INTERACTION_EVENT, handler)
    }, [])

    // ---- スライダー: 完全ローカルで即時再計算 ----
    const handleStrengthChange = useCallback((v: number) => {
        setStrength(v)
        setKV('filter_strength', v)
        if (vector) pushVectorToPersonalDB(vector, v)
    }, [vector])

    // ---- ジャンル除外をエンジンの候補集合に反映 ----
    const visibleArticles = useMemo(() => {
        if (excluded.size === 0) return articles
        return articles.filter(a => {
            const cats = (a.category || '').split(',').map(c => c.trim()).filter(Boolean)
            if (cats.length === 0) return true
            return cats.some(c => !excluded.has(c))
        })
    }, [articles, excluded])

    // ---- フィード計算（1000件×1024次元でも数十ms） ----
    const isFilterMode = !!(selectedCategory || dateFrom || dateTo)

    // 埋め込みがまだ1件も無い（Worker未処理）場合はベクトル分類ができないため、
    // 最新ニュースのリスト表示にフォールバックする（バブル分類は埋め込み生成後に有効化）。
    const hasEmbeddings = useMemo(() => articles.some(a => a.emb), [articles])
    const canRank = hasEmbeddings && !!vector

    const feed = useMemo(() => {
        if (loading || isFilterMode || !canRank) return { inBubble: [], outBubble: [] }
        return rankFeed(visibleArticles, vector, strength, seenIds, dismissedIds)
    }, [loading, isFilterMode, canRank, visibleArticles, vector, strength, seenIds, dismissedIds])

    const fallbackArticles = useMemo<GroupedArticle[]>(() => {
        if (loading) return []
        if (isFilterMode) {
            return filterArticles(visibleArticles, { category: selectedCategory, dateFrom, dateTo }, dismissedIds)
        }
        if (!canRank) {
            // 冷スタート or 埋め込み未生成: 最新記事のリスト表示
            return filterArticles(visibleArticles, {}, dismissedIds)
        }
        return []
    }, [loading, isFilterMode, canRank, visibleArticles, selectedCategory, dateFrom, dateTo, dismissedIds])

    // ---- オンボーディング: 関心カテゴリ選択から初期ベクトル生成 ----
    const completeOnboarding = async () => {
        const seed = seedVectorFromCategories(articles, Array.from(onboardingCats))
        if (seed) {
            setVector(seed)
            await setKV('user_vector', seed)
            await setKV('vector_updated_at', new Date().toISOString())
            pushVectorToPersonalDB(seed, strength)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">記事を同期しています…</p>
            </div>
        )
    }

    return (
        <div>
            {/* コンパクトヘッダー */}
            <header className="mb-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                    <h1 className="text-lg font-bold tracking-tight">きょうのニュース</h1>
                    <span className="text-[11px] text-muted-foreground tnum">{todayLabel()}</span>
                </div>
                {!isFilterMode && canRank && (
                    <LocalFilterSlider value={strength} onChange={handleStrengthChange} />
                )}
            </header>

            {!selectedCategory && <CategoryFilterBar onExcludeChange={setExcluded} />}

            {/* 記事パック未取得（初回・オフライン） */}
            {articles.length === 0 && (
                <div className="text-center py-16 bg-card border border-border rounded-xl space-y-3">
                    <p className="text-sm text-muted-foreground">記事データをまだ取得できていません</p>
                    <Button
                        size="sm" variant="outline"
                        onClick={() => location.reload()}
                        className="gap-1.5"
                    >
                        <RefreshCw className="w-3.5 h-3.5" />再読み込み
                    </Button>
                </div>
            )}

            {/* 埋め込み未生成のお知らせ（ニュースは最新順で表示中） */}
            {articles.length > 0 && !hasEmbeddings && !isFilterMode && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-accent/60 border border-primary/15 text-[11px] text-accent-foreground">
                    最新のニュースを表示しています。記事のAI分析（バブル分類・栄養素）は順次反映されます。
                </div>
            )}

            {/* オンボーディング: 埋め込みがあり、かつ関心ベクトル未生成のとき */}
            {!vector && hasEmbeddings && articles.length > 0 && !isFilterMode && (
                <div className="mb-4 p-4 rounded-xl bg-card border border-border">
                    <h2 className="text-[13px] font-bold mb-1">興味のあるジャンルを選んでください</h2>
                    <p className="text-[11px] text-muted-foreground mb-3">
                        選んだジャンルから最初の関心プロファイルを作ります。以降は読んだ記事から自動で学習します。
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                        {ONBOARDING_CATEGORIES.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setOnboardingCats(prev => {
                                    const next = new Set(prev)
                                    if (next.has(cat)) next.delete(cat); else next.add(cat)
                                    return next
                                })}
                                className={`h-7 px-2.5 text-[11px] font-medium rounded-full border transition-colors ${onboardingCats.has(cat)
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-transparent text-muted-foreground border-border hover:border-primary/50'}`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                    <Button
                        size="sm"
                        disabled={onboardingCats.size === 0}
                        onClick={completeOnboarding}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        この内容で開始
                    </Button>
                </div>
            )}

            {articles.length > 0 && (
                <BubbleFeedLayout
                    inBubbleArticles={feed.inBubble}
                    outBubbleArticles={feed.outBubble}
                    fallbackArticles={fallbackArticles}
                    bubbleMode={isFilterMode || !canRank ? 'none' : 'vector'}
                    filterStrength={strength}
                    selectedCategory={selectedCategory}
                />
            )}
        </div>
    )
}
