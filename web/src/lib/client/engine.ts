// ローカル推薦エンジン
// 記事の埋め込み（int8量子化）とユーザ関心ベクトル（float）から、
// バブル内/バブル外の分類・ランキング・類似記事グルーピングをすべてブラウザ内で計算する。

import { PackArticle } from './types'
import { Article, GroupedArticle } from '@/lib/types'

/** 類似度しきい値: これ以上=バブル内 */
export const BUBBLE_THRESHOLD = 0.65
/** 1ゾーンの最大記事数 */
export const ZONE_SIZE = 15
/** 同一トピックとみなすグルーピングしきい値。
 *  同じ出来事を複数メディアが報じたもの（BGE-M3で概ね0.88以上）を1枚に集約する。
 *  0.92だとほぼ重複記事しかまとまらず、0.85未満だと別の話題まで融合しやすい。 */
export const GROUPING_THRESHOLD = 0.88
/** クラスタリング対象の上限（性能のため候補を絞る） */
const CLUSTER_WINDOW = 60

// ---- 埋め込みデコード ----

const embCache = new Map<string, Float32Array>()

/** base64のint8埋め込みをデコードし、L2正規化されたFloat32Arrayを返す */
export function decodeEmb(b64: string): Float32Array {
    const cached = embCache.get(b64)
    if (cached) return cached

    const binary = atob(b64)
    const n = binary.length
    const vec = new Float32Array(n)
    let norm = 0
    for (let i = 0; i < n; i++) {
        let v = binary.charCodeAt(i)
        if (v > 127) v -= 256  // uint8 → int8
        vec[i] = v
        norm += v * v
    }
    norm = Math.sqrt(norm)
    if (norm > 0) {
        for (let i = 0; i < n; i++) vec[i] /= norm
    }
    if (embCache.size > 3000) embCache.clear()
    embCache.set(b64, vec)
    return vec
}

/** 両者とも正規化済み前提のコサイン類似度（= 内積） */
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
    const n = Math.min(a.length, b.length)
    if (n === 0) return 0
    let dot = 0
    for (let i = 0; i < n; i++) dot += (a as number[])[i] * (b as number[])[i]
    return dot
}

export function normalize(v: number[]): number[] {
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm)
    if (norm === 0) return v
    return v.map(x => x / norm)
}

// ---- 関心ベクトルの更新（クリック履歴からの学習） ----

/** 操作種別ごとの学習率 */
const LEARNING_RATE: Record<string, number> = {
    view: 0.12,
    deep_dive: 0.25,
}
const NEGATIVE_RATE = 0.15  // 興味なし

/**
 * 指数移動平均で関心ベクトルを更新する。
 * v ← normalize((1-α)·v + α·e)   （閲覧・深掘り）
 * v ← normalize(v - β·e)          （興味なし）
 */
export function updateVector(
    current: number[] | null,
    embB64: string,
    type: 'view' | 'deep_dive' | 'not_interested'
): number[] | null {
    const e = decodeEmb(embB64)
    if (!current || current.length === 0) {
        if (type === 'not_interested') return current
        return normalize(Array.from(e))
    }
    const v = current.slice()
    if (type === 'not_interested') {
        for (let i = 0; i < v.length && i < e.length; i++) v[i] -= NEGATIVE_RATE * e[i]
    } else {
        const alpha = LEARNING_RATE[type] ?? 0.1
        for (let i = 0; i < v.length && i < e.length; i++) v[i] = (1 - alpha) * v[i] + alpha * e[i]
    }
    return normalize(v)
}

/** オンボーディング: 選択カテゴリの記事埋め込み平均で初期ベクトルを生成 */
export function seedVectorFromCategories(articles: PackArticle[], categories: string[]): number[] | null {
    const selected = articles.filter(a => {
        const cats = (a.category || '').split(',').map(c => c.trim())
        return cats.some(c => categories.includes(c)) && a.emb
    }).slice(0, 100)
    if (selected.length === 0) return null

    const dim = decodeEmb(selected[0].emb!).length
    const sum = new Array<number>(dim).fill(0)
    for (const a of selected) {
        const e = decodeEmb(a.emb!)
        for (let i = 0; i < dim; i++) sum[i] += e[i]
    }
    return normalize(sum)
}

// ---- フィード生成 ----

export interface RankedFeed {
    inBubble: GroupedArticle[]
    outBubble: GroupedArticle[]
}

function toArticle(a: PackArticle, sim: number, inBubble: boolean): Article {
    return { ...a, embedding: undefined, inBubble, bubbleScore: sim } as unknown as Article
}

/**
 * フィード生成。
 * filterStrength S ∈ [0,1] はバブル外（発見）ゾーンの配分を制御する:
 *   バブル内 = ZONE_SIZE 件（関心ベクトルとの類似度順）
 *   バブル外 = round(ZONE_SIZE × S) 件（低類似度×新しさ順）
 */
export function rankFeed(
    articles: PackArticle[],
    userVector: number[] | null,
    filterStrength: number,
    seenIds: Set<string>,
    dismissedIds: Set<string>
): RankedFeed {
    const candidates = articles.filter(a =>
        a.emb && !seenIds.has(a.id) && !dismissedIds.has(a.id)
    )

    if (!userVector) {
        // 冷スタート: 最新記事をバブル外として表示
        const latest = candidates
            .sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || ''))
            .slice(0, ZONE_SIZE * 2)
            .map(a => toArticle(a, 0, false))
        return { inBubble: [], outBubble: groupArticles(latest) }
    }

    // 全候補の類似度を計算（1000件×1024次元でも数十ms）
    const scored = candidates.map(a => ({
        a,
        sim: cosine(userVector, decodeEmb(a.emb!)),
    }))

    const outCount = Math.round(ZONE_SIZE * filterStrength)

    // --- バブル内: 類似度上位をクラスタリングしてから上位ZONE_SIZE「クラスタ」を採用 ---
    // 先に類似度降順で束ねるので、各クラスタの代表(lead)は最も関心に近い記事になる。
    // 同じ話題を複数メディアが報じたものは1枚のカードに集約される。
    const inWindow = scored
        .filter(s => s.sim >= BUBBLE_THRESHOLD)
        .sort((x, y) => y.sim - x.sim)
        .slice(0, CLUSTER_WINDOW)
    const inGrouped = groupArticles(inWindow.map(s => toArticle(s.a, s.sim, true)))
    const inBubble = inGrouped.slice(0, ZONE_SIZE)

    // バブル内に採用済みの記事（代表＋関連）は除外
    const usedIds = new Set<string>()
    for (const g of inBubble) {
        usedIds.add(g.id)
        for (const r of g.related) usedIds.add(r.id)
    }

    // --- バブル外: 低類似度を新しさ優先でクラスタリング ---
    const outWindow = scored
        .filter(s => s.sim < BUBBLE_THRESHOLD && !usedIds.has(s.a.id))
        .sort((x, y) => {
            const d = (y.a.collected_at || '').localeCompare(x.a.collected_at || '')
            return d !== 0 ? d : x.sim - y.sim
        })
        .slice(0, CLUSTER_WINDOW)
    const outGrouped = groupArticles(outWindow.map(s => toArticle(s.a, s.sim, false)))
    const outBubble = outGrouped.slice(0, outCount)

    return { inBubble, outBubble }
}

/** カテゴリ・日付フィルタモード / 冷スタートの単純リスト。
 *  閲覧済み(seenIds)・興味なし(dismissedIds)は除外する（見た記事はフィードから消える）。 */
export function filterArticles(
    articles: PackArticle[],
    opts: { category?: string | null; dateFrom?: string | null; dateTo?: string | null },
    seenIds: Set<string>,
    dismissedIds: Set<string>
): GroupedArticle[] {
    let list = articles.filter(a => !seenIds.has(a.id) && !dismissedIds.has(a.id))
    if (opts.category) {
        list = list.filter(a => (a.category || '').includes(opts.category!))
    }
    if (opts.dateFrom) {
        list = list.filter(a => (a.collected_at || '') >= `${opts.dateFrom}T00:00:00+09:00`)
    }
    if (opts.dateTo) {
        list = list.filter(a => (a.collected_at || '') <= `${opts.dateTo}T23:59:59+09:00`)
    }
    const sorted = list
        .sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || ''))
        .slice(0, 60)
        .map(a => toArticle(a, 0, false))
    return groupArticles(sorted)
}

// ---- 類似記事グルーピング（貪欲クラスタリング） ----

export function groupArticles(articles: Article[], threshold: number = GROUPING_THRESHOLD): GroupedArticle[] {
    if (articles.length === 0) return []
    const embOf = (a: Article): Float32Array | null => {
        const raw = (a as unknown as { emb?: string | null }).emb
        return raw ? decodeEmb(raw) : null
    }

    const grouped: GroupedArticle[] = []
    const used = new Set<string>()

    for (const article of articles) {
        if (used.has(article.id)) continue
        used.add(article.id)
        const group: GroupedArticle = { ...article, related: [] }
        const embI = embOf(article)
        if (embI) {
            for (const other of articles) {
                if (used.has(other.id)) continue
                const embJ = embOf(other)
                if (!embJ) continue
                if (cosine(embI, embJ) >= threshold) {
                    group.related.push(other)
                    used.add(other.id)
                }
            }
        }
        grouped.push(group)
    }
    return grouped
}
