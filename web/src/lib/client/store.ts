'use client'

// IndexedDB ローカルストア
// 記事キャッシュ・閲覧履歴・関心ベクトル等、嗜好に関わるデータはすべてここに保存する。
// サーバ（共有Supabase）には一切送信しない。

import { PackArticle, LocalInteraction } from './types'

const DB_NAME = 'ownnews'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains('articles')) {
                const s = db.createObjectStore('articles', { keyPath: 'id' })
                s.createIndex('collected_at', 'collected_at')
            }
            if (!db.objectStoreNames.contains('interactions')) {
                db.createObjectStore('interactions', { keyPath: ['article_id', 'type'] })
            }
            if (!db.objectStoreNames.contains('kv')) {
                db.createObjectStore('kv')
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
    return dbPromise
}

function tx<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openDB().then(db => new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode)
        const req = fn(t.objectStore(storeName))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    }))
}

// ---- 記事キャッシュ ----

export async function putArticles(articles: PackArticle[]): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const t = db.transaction('articles', 'readwrite')
        const store = t.objectStore('articles')
        for (const a of articles) store.put(a)
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
    })
}

export async function getAllArticles(): Promise<PackArticle[]> {
    return tx('articles', 'readonly', s => s.getAll() as IDBRequest<PackArticle[]>)
}

/** 端末が保持する記事の窓。サーバの記事DBのretentionと同じ7日にそろえる。
 *
 *  以前は「最新1500件」という件数で切っていた。その値には導出が無く、容量にも
 *  計算量にも縛られていない（7日分=約5600件でもIndexedDB 12.5MB・コサイン570万積和）。
 *  一方、設計上の概念（サーバの7日retention、パックの72時間プール）はすべて時間で
 *  切られており、件数で切ると端末が保持する期間が記事の流量に応じて動いてしまう。
 *  現在の流量では1500件は約2日分でしかなく、サーバが保持する窓より短かった。 */
const ARTICLE_WINDOW_DAYS = 7
/** 流量が異常に増えたときの保険。通常は日数側で先に切られる。 */
const ARTICLE_HARD_CAP = 20000

/** 保持窓の外に出た記事を削除してキャッシュ肥大を防ぐ。 */
export async function pruneArticles(
    windowDays: number = ARTICLE_WINDOW_DAYS,
    hardCap: number = ARTICLE_HARD_CAP,
): Promise<void> {
    const all = await getAllArticles()
    const cutoff = new Date(Date.now() - windowDays * 86400_000).toISOString()
    // collected_at が無い記事は日数で判定できないため、ここでは消さない（hardCap側に委ねる）
    const toDelete = all.filter(a => a.collected_at && a.collected_at < cutoff)

    const remaining = all.length - toDelete.length
    if (remaining > hardCap) {
        const kept = all
            .filter(a => !(a.collected_at && a.collected_at < cutoff))
            .sort((x, y) => (y.collected_at || '').localeCompare(x.collected_at || ''))
        toDelete.push(...kept.slice(hardCap))
    }
    if (toDelete.length === 0) return
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const t = db.transaction('articles', 'readwrite')
        const store = t.objectStore('articles')
        for (const a of toDelete) store.delete(a.id)
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
    })
}

// ---- 閲覧履歴 ----

export async function putInteraction(i: LocalInteraction): Promise<void> {
    await tx('interactions', 'readwrite', s => s.put(i))
}

export async function getAllInteractions(): Promise<LocalInteraction[]> {
    return tx('interactions', 'readonly', s => s.getAll() as IDBRequest<LocalInteraction[]>)
}

/** 指定した (article_id, type) の操作をローカルキャッシュから削除する */
export async function deleteInteractions(keys: [string, string][]): Promise<void> {
    if (keys.length === 0) return
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const t = db.transaction('interactions', 'readwrite')
        const store = t.objectStore('interactions')
        for (const key of keys) store.delete(key)
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
    })
}

export async function markInteractionsSynced(keys: [string, string][]): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const t = db.transaction('interactions', 'readwrite')
        const store = t.objectStore('interactions')
        for (const key of keys) {
            const req = store.get(key)
            req.onsuccess = () => {
                if (req.result) store.put({ ...req.result, synced: true })
            }
        }
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
    })
}

// ---- KV（関心ベクトル・設定・同期時刻） ----

export async function getKV<T>(key: string): Promise<T | undefined> {
    return tx('kv', 'readonly', s => s.get(key) as IDBRequest<T | undefined>)
}

export async function setKV<T>(key: string, value: T): Promise<void> {
    await tx('kv', 'readwrite', s => s.put(value, key))
}

/** ローカルデータ全消去（設定画面のリセット用） */
export async function clearAll(): Promise<void> {
    const db = await openDB()
    return new Promise((resolve, reject) => {
        const t = db.transaction(['articles', 'interactions', 'kv'], 'readwrite')
        t.objectStore('articles').clear()
        t.objectStore('interactions').clear()
        t.objectStore('kv').clear()
        t.oncomplete = () => resolve()
        t.onerror = () => reject(t.error)
    })
}
