'use client'

// 推薦フィード
// 関心ベクトルとの類似度計算・バブル分類・グルーピング・スライダー応答・
// ジャンル除外を各ユーザーの端末で実行する（推薦計算はクライアント側）。
// 推薦に使うデータ（ベクトル・強度・カテゴリON/OFF・操作履歴）は運営Supabaseに
// ユーザー単位で保存し端末間同期。IndexedDBは高速表示用キャッシュ。

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { BubbleFeedLayout } from '@/components/bubble-feed-layout'
import { TopicFeed } from '@/components/topic-feed'
import { WatchedSection } from '@/components/watched-section'
import { LocalFilterSlider } from '@/components/local-filter-slider'
import { TextSizeControl } from '@/components/text-size-control'
import { CategoryFilterBar, loadExcluded, saveExcluded } from '@/components/category-filter-bar'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, X } from 'lucide-react'
import { GroupedArticle, ONBOARDING_CATEGORIES } from '@/lib/types'
import { PackArticle } from '@/lib/client/types'
import { loadArticles } from '@/lib/client/pack'
import { rankFeed, filterArticles, searchArticles, seedVectorFromCategories } from '@/lib/client/engine'
import { WatchTagChip } from '@/components/watch-tag-chip'
import { getKV, setKV, getAllInteractions } from '@/lib/client/store'
import { pullUserData, pushVector, pushSettings } from '@/lib/client/sync'
import { INTERACTION_EVENT } from '@/lib/client/interactions'

function todayLabel(): string {
    const d = new Date()
    const days = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`
}

export function LocalFeed() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const selectedCategory = searchParams.get('category')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const searchQuery = searchParams.get('q')

    const [articles, setArticles] = useState<PackArticle[]>([])
    const [vector, setVector] = useState<number[] | null>(null)
    const [strength, setStrength] = useState(0.5)
    const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
    const [excluded, setExcluded] = useState<Set<string>>(new Set())
    const [loading, setLoading] = useState(true)
    const [onboardingCats, setOnboardingCats] = useState<Set<string>>(new Set())

    // ---- 初期化: パック同期 + ローカルキャッシュ読み込み + 運営Supabase同期 ----
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

            // 運営Supabaseと同期（ログイン時。別端末の学習・設定を取り込み、
            // 未同期のローカル操作をpush）。サーバーが真実の источник。
            const remote = await pullUserData()
            if (!cancelled && remote) {
                if (remote.vector) setVector(remote.vector)
                if (typeof remote.filterStrength === 'number') setStrength(remote.filterStrength)
                if (remote.excludedCategories) {
                    const set = new Set(remote.excludedCategories)
                    saveExcluded(set)          // CategoryFilterBar(localStorage読み込み)と整合
                    setExcluded(set)
                }
                // リモートから取り込んだ操作履歴で既読/非表示を更新
                const merged = await getAllInteractions()
                const seen2 = new Set<string>()
                const dismissed2 = new Set<string>()
                for (const i of merged) {
                    seen2.add(i.article_id)
                    if (i.type === 'not_interested') dismissed2.add(i.article_id)
                }
                setSeenIds(seen2)
                setDismissedIds(dismissed2)
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

    // ---- 表示ビュー: おまかせ（バブル） / トピック別。端末に記憶 ----
    const [view, setView] = useState<'mix' | 'topics'>(() => {
        if (typeof window === 'undefined') return 'mix'
        return localStorage.getItem('ownnews_feedview') === 'topics' ? 'topics' : 'mix'
    })
    const changeView = (v: 'mix' | 'topics') => {
        setView(v)
        try { localStorage.setItem('ownnews_feedview', v) } catch { /* noop */ }
    }

    // ---- スライダー: 端末側で即時再計算し、設定を運営Supabaseへ同期 ----
    const handleStrengthChange = useCallback((v: number) => {
        setStrength(v)
        setKV('filter_strength', v)
        pushSettings({ filterStrength: v })
    }, [])

    // ---- ジャンルON/OFF: 端末間同期のため運営Supabaseへも保存 ----
    const handleExcludeChange = useCallback((next: Set<string>) => {
        setExcluded(next)
        pushSettings({ excludedCategories: Array.from(next) })
    }, [])

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
    const isFilterMode = !!(selectedCategory || dateFrom || dateTo || searchQuery)

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
        if (searchQuery) {
            // 検索はジャンル非表示・既読除外より優先（探し物は全記事から）
            return searchArticles(articles, searchQuery, dismissedIds)
        }
        if (isFilterMode) {
            return filterArticles(visibleArticles, { category: selectedCategory, dateFrom, dateTo }, seenIds, dismissedIds)
        }
        if (!canRank) {
            // 冷スタート or 埋め込み未生成: 最新記事のリスト表示（閲覧済みは除外）
            return filterArticles(visibleArticles, {}, seenIds, dismissedIds)
        }
        return []
    }, [loading, isFilterMode, canRank, articles, visibleArticles, selectedCategory, dateFrom, dateTo, searchQuery, seenIds, dismissedIds])

    // ---- オンボーディング: 関心カテゴリ選択から初期ベクトル生成 ----
    const completeOnboarding = async () => {
        const seed = seedVectorFromCategories(articles, Array.from(onboardingCats))
        if (seed) {
            const now = new Date().toISOString()
            setVector(seed)
            await setKV('user_vector', seed)
            await setKV('vector_updated_at', now)
            pushVector(seed, now)
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
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                        <h1 className="text-lg font-bold tracking-tight">きょうのニュース</h1>
                        <span className="text-[11px] text-muted-foreground tnum">{todayLabel()}</span>
                    </div>
                    {/* モバイルではタイトル行の右に置く */}
                    <TextSizeControl className="inline-flex md:hidden" />
                </div>
                <div className="flex items-center gap-2">
                    <TextSizeControl className="hidden md:inline-flex" />
                    {!isFilterMode && canRank && view === 'mix' && (
                        <LocalFilterSlider value={strength} onChange={handleStrengthChange} />
                    )}
                </div>
            </header>

            {!selectedCategory && !searchQuery && <CategoryFilterBar excluded={excluded} onExcludeChange={handleExcludeChange} />}

            {/* 検索モード: 結果ヘッダー。キーワードはその場でウォッチタグ化できる */}
            {searchQuery && (
                <div className="mb-3 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-muted-foreground">検索:</span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-foreground bg-accent rounded-full pl-2.5 pr-1 py-0.5">
                        {searchQuery}
                        <button
                            onClick={() => router.push('/')}
                            aria-label="検索を解除"
                            className="h-4 w-4 rounded-full inline-flex items-center justify-center hover:bg-black/10"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                    <span className="text-[11px] text-muted-foreground tnum">{fallbackArticles.length}件</span>
                    <WatchTagChip tag={searchQuery} action />
                </div>
            )}

            {searchQuery && articles.length > 0 && fallbackArticles.length === 0 && (
                <div className="text-center py-12 bg-card border border-border rounded-xl space-y-1">
                    <p className="text-sm text-muted-foreground">「{searchQuery}」に一致する記事は見つかりませんでした</p>
                    <p className="text-[11px] text-muted-foreground">
                        ウォッチタグに追加しておくと、この言葉を含む記事が届き次第トップの専用枠に表示されます
                    </p>
                </div>
            )}

            {/* 表示ビュー切替: おまかせ（バブル） / トピック別 */}
            {!isFilterMode && articles.length > 0 && (
                <div className="mb-3 inline-flex items-center rounded-lg border border-border bg-card p-0.5" role="group" aria-label="表示ビュー">
                    {([
                        { id: 'mix', label: 'おまかせ' },
                        { id: 'topics', label: 'トピック別' },
                    ] as { id: 'mix' | 'topics'; label: string }[]).map(v => (
                        <button
                            key={v.id}
                            onClick={() => changeView(v.id)}
                            aria-pressed={view === v.id}
                            className={`h-7 px-3 text-[12px] font-medium rounded-md transition-colors ${view === v.id
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
            )}

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

            {/* ウォッチ中（タグ購読）: 確実に見たい記事の専用枠。ジャンル非表示より優先 */}
            {articles.length > 0 && !isFilterMode && (
                <WatchedSection
                    articles={articles}
                    seenIds={seenIds}
                    dismissedIds={dismissedIds}
                    onCategoryClick={(cat) => router.push(`/?category=${encodeURIComponent(cat)}`)}
                />
            )}

            {articles.length > 0 && !(searchQuery && fallbackArticles.length === 0) && (
                view === 'topics' && !isFilterMode ? (
                    <TopicFeed
                        articles={visibleArticles}
                        seenIds={seenIds}
                        dismissedIds={dismissedIds}
                        onCategoryClick={(cat) => router.push(`/?category=${encodeURIComponent(cat)}`)}
                    />
                ) : (
                    <BubbleFeedLayout
                        inBubbleArticles={feed.inBubble}
                        outBubbleArticles={feed.outBubble}
                        fallbackArticles={fallbackArticles}
                        bubbleMode={isFilterMode || !canRank ? 'none' : 'vector'}
                        filterStrength={strength}
                        selectedCategory={selectedCategory}
                    />
                )
            )}
        </div>
    )
}
