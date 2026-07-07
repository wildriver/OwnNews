'use client'

// ローカル推薦フィード
// 記事パックをIndexedDBに同期し、関心ベクトルとの類似度計算・バブル分類・
// グルーピング・スライダー応答をすべてブラウザ内で行う。
// 嗜好データは端末内（+設定時は個人Supabase）にのみ保存される。

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { BubbleFeedLayout } from '@/components/bubble-feed-layout'
import { LocalFilterSlider } from '@/components/local-filter-slider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Settings } from 'lucide-react'
import { GroupedArticle, ONBOARDING_CATEGORIES } from '@/lib/types'
import { PackArticle } from '@/lib/client/types'
import { loadArticles } from '@/lib/client/pack'
import { rankFeed, filterArticles, seedVectorFromCategories } from '@/lib/client/engine'
import { getKV, setKV, getAllInteractions } from '@/lib/client/store'
import { getPersonalConfig, syncWithPersonalDB, pushVectorToPersonalDB } from '@/lib/client/personal'
import { INTERACTION_EVENT } from '@/lib/client/interactions'

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
    const [loading, setLoading] = useState(true)
    const [hasPersonalDB, setHasPersonalDB] = useState(false)
    const [onboardingCats, setOnboardingCats] = useState<Set<string>>(new Set())

    // ---- 初期化: パック同期 + ローカル状態読み込み + 個人DB同期 ----
    useEffect(() => {
        let cancelled = false
        const init = async () => {
            setHasPersonalDB(!!getPersonalConfig())

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

    // ---- フィード計算（useMemoで同期的に。1000件×1024次元でも数十ms） ----
    const isFilterMode = !!(selectedCategory || dateFrom || dateTo)

    const feed = useMemo(() => {
        if (loading) return { inBubble: [], outBubble: [] }
        if (isFilterMode) return { inBubble: [], outBubble: [] }
        return rankFeed(articles, vector, strength, seenIds, dismissedIds)
    }, [loading, isFilterMode, articles, vector, strength, seenIds, dismissedIds])

    const fallbackArticles = useMemo<GroupedArticle[]>(() => {
        if (loading || !isFilterMode) return []
        return filterArticles(articles, { category: selectedCategory, dateFrom, dateTo }, dismissedIds)
    }, [loading, isFilterMode, articles, selectedCategory, dateFrom, dateTo, dismissedIds])

    // ---- オンボーディング: 関心カテゴリ選択から初期ベクトル生成 ----
    const completeOnboarding = async () => {
        const seed = seedVectorFromCategories(articles, Array.from(onboardingCats))
        if (seed) {
            const now = new Date().toISOString()
            setVector(seed)
            await setKV('user_vector', seed)
            await setKV('vector_updated_at', now)
            pushVectorToPersonalDB(seed, strength)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-sm">記事パックを同期しています…</p>
            </div>
        )
    }

    return (
        <div>
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
                        Your Feed
                    </h1>
                    <p className="text-slate-400 text-sm">
                        推薦エンジンはこの端末の中で動いています
                        {!hasPersonalDB && (
                            <Link href="/settings" className="ml-2 text-sky-400/70 hover:text-sky-300 underline underline-offset-2">
                                <Settings className="inline w-3 h-3 mr-0.5" />個人DBを接続
                            </Link>
                        )}
                    </p>
                </div>
                {!isFilterMode && (
                    <LocalFilterSlider value={strength} onChange={handleStrengthChange} />
                )}
            </header>

            {/* オンボーディング: ベクトル未生成時 */}
            {!vector && !isFilterMode && (
                <div className="mb-8 p-5 rounded-xl bg-sky-500/5 border border-sky-500/20">
                    <h2 className="text-sm font-bold text-slate-200 mb-1">興味のあるジャンルを選んでください</h2>
                    <p className="text-xs text-slate-500 mb-3">
                        選択したジャンルから初期の関心ベクトルを作ります。以降は記事のクリックから自動で学習します。
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4">
                        {ONBOARDING_CATEGORIES.map(cat => (
                            <Badge
                                key={cat}
                                onClick={() => setOnboardingCats(prev => {
                                    const next = new Set(prev)
                                    if (next.has(cat)) next.delete(cat); else next.add(cat)
                                    return next
                                })}
                                className={`cursor-pointer px-3 py-1 transition-colors ${onboardingCats.has(cat)
                                    ? 'bg-sky-500/30 text-sky-200 border-sky-400/50'
                                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}
                            >
                                {cat}
                            </Badge>
                        ))}
                    </div>
                    <Button
                        size="sm"
                        disabled={onboardingCats.size === 0}
                        onClick={completeOnboarding}
                        className="bg-sky-600 hover:bg-sky-500 text-white"
                    >
                        この内容で開始
                    </Button>
                </div>
            )}

            <BubbleFeedLayout
                inBubbleArticles={feed.inBubble}
                outBubbleArticles={feed.outBubble}
                fallbackArticles={fallbackArticles}
                bubbleMode={isFilterMode ? 'none' : 'vector'}
                userTopCats={[]}
                filterStrength={strength}
                selectedCategory={selectedCategory}
                dateFrom={dateFrom}
                dateTo={dateTo}
            />
        </div>
    )
}
