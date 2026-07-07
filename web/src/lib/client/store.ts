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

/** 古い記事を削除してキャッシュ肥大を防ぐ（最新maxCount件だけ残す） */
export async function pruneArticles(maxCount: number = 1500): Promise<void> {
    const all = await getAllArticles()
    if (all.length <= maxCount) return
    const sorted = all.sort((a, b) => (b.collected_at || '').localeCompare(a.collected_at || ''))
    const toDelete = sorted.slice(maxCount)
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
