'use client'

// 記事パックの取得・差分同期
// 初回は最新パックを一括取得してIndexedDBにキャッシュし、
// 以降は前回同期時刻からの差分のみ取得する。

import { PackArticle } from './types'
import { putArticles, getAllArticles, getKV, setKV, pruneArticles } from './store'

const LAST_SYNC_KEY = 'pack_last_sync'
const MIN_SYNC_INTERVAL_MS = 5 * 60 * 1000  // 5分以内の再同期はスキップ

interface PackResponse {
    dim: number
    count: number
    latest: string
    articles: PackArticle[]
}

/**
 * 記事キャッシュを返す。必要なら裏で差分同期する。
 * 戻り値: { articles, fromCache } — キャッシュがあれば即座に返し、同期は非同期に走る
 */
export async function loadArticles(onUpdate?: (articles: PackArticle[]) => void): Promise<PackArticle[]> {
    const cached = await getAllArticles()
    const lastFetchedAt = (await getKV<number>('pack_last_fetched_ms')) || 0
    const needsSync = Date.now() - lastFetchedAt > MIN_SYNC_INTERVAL_MS

    if (cached.length > 0 && !needsSync) {
        return sortByDate(cached)
    }

    if (cached.length === 0) {
        // 初回: 同期を待つ
        await syncPack()
        return sortByDate(await getAllArticles())
    }

    // キャッシュ表示 + 裏で差分同期
    syncPack().then(async (added) => {
        if (added > 0 && onUpdate) {
            onUpdate(sortByDate(await getAllArticles()))
        }
    })
    return sortByDate(cached)
}

async function syncPack(): Promise<number> {
    try {
        const since = await getKV<string>(LAST_SYNC_KEY)
        const url = since ? `/api/pack?since=${encodeURIComponent(since)}` : '/api/pack'
        const res = await fetch(url)
        if (!res.ok) throw new Error(`pack fetch failed: ${res.status}`)
        const data: PackResponse = await res.json()

        if (data.articles?.length > 0) {
            await putArticles(data.articles)
            await pruneArticles()
        }
        if (data.latest) await setKV(LAST_SYNC_KEY, data.latest)
        await setKV('pack_last_fetched_ms', Date.now())
        return data.articles?.length || 0
    } catch (e) {
        console.warn('Pack sync failed (using cache):', e)
        return 0
    }
}

function sortByDate(articles: PackArticle[]): PackArticle[] {
    return articles.sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || ''))
}
