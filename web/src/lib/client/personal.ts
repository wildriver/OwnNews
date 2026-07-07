'use client'

// 個人Supabase（ユーザ所有DB）との同期
// 「個人のSupabase = ローカル」モデル: 嗜好データ（閲覧履歴・関心ベクトル）は
// 運営側の共有DBには置かず、ユーザ自身が用意したSupabaseプロジェクトにのみ保存する。
// 未設定でも端末内(IndexedDB)だけで完結して動作する。

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { PersonalDBConfig, LocalInteraction } from './types'
import { getAllInteractions, markInteractionsSynced, getKV, setKV } from './store'

const CONFIG_KEY = 'ownnews_personal_db'

export function getPersonalConfig(): PersonalDBConfig | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = localStorage.getItem(CONFIG_KEY)
        if (!raw) return null
        const cfg = JSON.parse(raw)
        if (cfg.url && cfg.key) return cfg
    } catch { /* ignore */ }
    return null
}

export function setPersonalConfig(cfg: PersonalDBConfig | null): void {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
    else localStorage.removeItem(CONFIG_KEY)
}

let client: SupabaseClient | null = null
let clientUrl = ''

export function getPersonalClient(): SupabaseClient | null {
    const cfg = getPersonalConfig()
    if (!cfg) return null
    if (!client || clientUrl !== cfg.url) {
        client = createClient(cfg.url, cfg.key, { auth: { persistSession: false } })
        clientUrl = cfg.url
    }
    return client
}

/** 接続テスト（設定画面用） */
export async function testPersonalConnection(cfg: PersonalDBConfig): Promise<{ ok: boolean; message: string }> {
    try {
        const c = createClient(cfg.url, cfg.key, { auth: { persistSession: false } })
        const { error } = await c.from('my_state').select('id').limit(1)
        if (error) return { ok: false, message: `接続エラー: ${error.message}（personal_supabase_schema.sql は実行済みですか？）` }
        return { ok: true, message: '接続成功' }
    } catch (e) {
        return { ok: false, message: `接続失敗: ${String(e)}` }
    }
}

/** 起動時同期: リモートの関心ベクトルが新しければ取り込み、未同期の履歴をpushする */
export async function syncWithPersonalDB(): Promise<{ vector: number[] | null; updatedAt: string } | null> {
    const c = getPersonalClient()
    if (!c) return null

    try {
        // 1. リモート状態を取得
        const { data: remote } = await c.from('my_state').select('vector, filter_strength, updated_at').eq('id', 1).maybeSingle()

        const localUpdatedAt = (await getKV<string>('vector_updated_at')) || ''
        let result: { vector: number[] | null; updatedAt: string } | null = null

        if (remote?.vector && remote.updated_at > localUpdatedAt) {
            // リモートが新しい → ローカルに取り込み（別端末での学習を反映）
            const vec = Array.isArray(remote.vector) ? remote.vector : JSON.parse(remote.vector)
            await setKV('user_vector', vec)
            await setKV('vector_updated_at', remote.updated_at)
            if (typeof remote.filter_strength === 'number') {
                await setKV('filter_strength', remote.filter_strength)
            }
            result = { vector: vec, updatedAt: remote.updated_at }
        }

        // 2. 未同期の履歴をpush
        const all = await getAllInteractions()
        const unsynced = all.filter(i => !i.synced)
        if (unsynced.length > 0) {
            const rows = unsynced.map(i => ({
                article_id: i.article_id,
                interaction_type: i.type,
                created_at: i.created_at,
                category: i.category || '',
                category_medium: i.category_medium || '',
                category_minor: i.category_minor || [],
                fact_score: i.fact_score ?? null,
                context_score: i.context_score ?? null,
                perspective_score: i.perspective_score ?? null,
                emotion_score: i.emotion_score ?? null,
                immediacy_score: i.immediacy_score ?? null,
            }))
            const { error } = await c.from('my_interactions').upsert(rows, { onConflict: 'article_id, interaction_type' })
            if (!error) {
                await markInteractionsSynced(unsynced.map(i => [i.article_id, i.type]))
            }
        }

        return result
    } catch (e) {
        console.warn('Personal DB sync failed (continuing local-only):', e)
        return null
    }
}

/** 関心ベクトル更新後のpush（fire-and-forget） */
export function pushVectorToPersonalDB(vector: number[], filterStrength: number): void {
    const c = getPersonalClient()
    if (!c) return
    const updatedAt = new Date().toISOString()
    c.from('my_state').upsert({
        id: 1,
        vector,
        filter_strength: filterStrength,
        updated_at: updatedAt,
    }).then(({ error }) => {
        if (error) console.warn('Vector push failed:', error.message)
    })
}

/** 履歴1件のpush（fire-and-forget） */
export function pushInteractionToPersonalDB(i: LocalInteraction): void {
    const c = getPersonalClient()
    if (!c) return
    c.from('my_interactions').upsert({
        article_id: i.article_id,
        interaction_type: i.type,
        created_at: i.created_at,
        category: i.category || '',
        category_medium: i.category_medium || '',
        category_minor: i.category_minor || [],
        fact_score: i.fact_score ?? null,
        context_score: i.context_score ?? null,
        perspective_score: i.perspective_score ?? null,
        emotion_score: i.emotion_score ?? null,
        immediacy_score: i.immediacy_score ?? null,
    }, { onConflict: 'article_id, interaction_type' }).then(({ error }) => {
        if (!error) markInteractionsSynced([[i.article_id, i.type]])
    })
}
