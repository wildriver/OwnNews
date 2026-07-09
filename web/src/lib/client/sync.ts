'use client'

// 運営Supabaseとの同期（Phase 1）
// Googleログインで識別された本人の行だけを、認証済みブラウザクライアント経由で
// RLSのもと読み書きする。保存対象は「推薦に使う情報」:
//   - 関心ベクトル（user_vectors.vector_m3）
//   - フィルタ強度・カテゴリON/OFF（user_profile）
//   - 操作履歴（user_interactions）
// IndexedDBは高速表示・オフライン用のキャッシュ。サーバーが真実の источник。
// 推薦の計算自体は各端末で実行（サーバーは保存と配信のみ）。

import { createClient } from '@/lib/supabase/client'
import {
    getAllInteractions, markInteractionsSynced, putInteraction, setKV, getKV, clearAll,
} from './store'
import { LocalInteraction, InteractionType } from './types'

/** 同期完了時に発火。フィード/履歴/ダッシュボードが再読込するためのイベント。 */
export const SYNCED_EVENT = 'ownnews:synced'

let cachedEmail: string | null | undefined = undefined
let pullPromise: Promise<RemoteState | null> | null = null

/** ログイン中ユーザーのメール（=user_id）。未ログインならnull。 */
export async function getUserEmail(): Promise<string | null> {
    if (cachedEmail !== undefined) return cachedEmail
    try {
        const supabase = createClient()
        const { data } = await supabase.auth.getUser()
        cachedEmail = data.user?.email ?? null
    } catch {
        cachedEmail = null
    }
    return cachedEmail
}

export function clearEmailCache() {
    cachedEmail = undefined
}

export interface RemoteState {
    vector: number[] | null
    filterStrength: number | null
    excludedCategories: string[] | null
    vectorUpdatedAt: string | null
}

function parseVector(v: unknown): number[] | null {
    if (!v) return null
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
    if (Array.isArray(v)) return v as number[]
    return null
}

/**
 * ログイン時の初回同期（セッション内で1回だけ実行、以降は同じ結果を返す）:
 *  0) 別ユーザーが同じブラウザを使っていたらローカルキャッシュを消去（分離）
 *  1) profile行を保証（無ければ作成）
 *  2) リモートの状態と操作履歴をローカルキャッシュへ取り込む
 *  3) 未同期のローカル操作をpush
 *  4) 完了イベントを発火
 * 戻り値: リモートの推薦状態（フィード初期化に使用）
 */
export function pullUserData(): Promise<RemoteState | null> {
    if (!pullPromise) pullPromise = doPull()
    return pullPromise
}

async function doPull(): Promise<RemoteState | null> {
    const email = await getUserEmail()
    if (!email) return null
    const supabase = createClient()

    try {
        // 別ユーザーが直前に使っていたら、その人のキャッシュを消してから取り込む
        const owner = await getKV<string>('cache_owner')
        if (owner && owner !== email) {
            await clearAll()
        }
        await setKV('cache_owner', email)

        // profile存在保証（FK先。無いとinteraction/vectorのupsertが失敗する）
        await supabase.from('user_profile').upsert(
            { user_id: email, onboarded: true },
            { onConflict: 'user_id' }
        )

        const [{ data: profile }, { data: vecRow }, { data: remoteInts }] = await Promise.all([
            supabase.from('user_profile').select('filter_strength, excluded_categories').eq('user_id', email).maybeSingle(),
            supabase.from('user_vectors').select('vector_m3, updated_at').eq('user_id', email).maybeSingle(),
            supabase.from('user_interactions')
                .select('article_id, interaction_type, created_at, category, category_medium, title, link, dwell_seconds, scroll_depth')
                .eq('user_id', email)
                .order('created_at', { ascending: false })
                .limit(2000),
        ])

        // リモート操作履歴をローカルキャッシュへ反映（同期済みフラグ付き）
        if (remoteInts) {
            const localByKey = new Map(
                (await getAllInteractions()).map(i => [`${i.article_id}|${i.type}`, i])
            )
            for (const r of remoteInts) {
                const key = `${r.article_id}|${r.interaction_type}`
                const local = localByKey.get(key)
                // 未取り込み、またはリモートのdwellの方が大きければ取り込む
                if (!local || (r.dwell_seconds || 0) > (local.dwell_seconds || 0)) {
                    await putInteraction({
                        article_id: r.article_id,
                        type: r.interaction_type as InteractionType,
                        created_at: r.created_at,
                        category: r.category || undefined,
                        category_medium: r.category_medium || undefined,
                        title: r.title || undefined,
                        link: r.link || undefined,
                        dwell_seconds: r.dwell_seconds || undefined,
                        scroll_depth: r.scroll_depth || undefined,
                        synced: true,
                    })
                }
            }
        }

        const vector = parseVector(vecRow?.vector_m3)
        if (vector) {
            await setKV('user_vector', vector)
            if (vecRow?.updated_at) await setKV('vector_updated_at', vecRow.updated_at)
        }
        if (typeof profile?.filter_strength === 'number') {
            await setKV('filter_strength', profile.filter_strength)
        }

        // 未同期のローカル操作をpush
        await pushUnsyncedInteractions()

        // 履歴・ダッシュボード等に「取り込み完了」を通知
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(SYNCED_EVENT))
        }

        return {
            vector,
            filterStrength: typeof profile?.filter_strength === 'number' ? profile.filter_strength : null,
            excludedCategories: Array.isArray(profile?.excluded_categories) ? profile!.excluded_categories : null,
            vectorUpdatedAt: vecRow?.updated_at ?? null,
        }
    } catch (e) {
        console.warn('pullUserData failed (using local cache):', e)
        return null
    }
}

/** 操作1件をSupabaseへ（fire-and-forget）。ログイン時のみ。 */
export function pushInteraction(i: LocalInteraction): void {
    getUserEmail().then(email => {
        if (!email) return
        const supabase = createClient()
        supabase.from('user_interactions').upsert({
            user_id: email,
            article_id: i.article_id,
            interaction_type: i.type,
            created_at: i.created_at,
            category: i.category || '',
            category_medium: i.category_medium || '',
            title: i.title || '',
            link: i.link || '',
            dwell_seconds: i.dwell_seconds ?? 0,
            scroll_depth: i.scroll_depth ?? 0,
        }, { onConflict: 'user_id, article_id, interaction_type' }).then(({ error }) => {
            if (!error) markInteractionsSynced([[i.article_id, i.type]])
        })
    })
}

async function pushUnsyncedInteractions(): Promise<void> {
    const email = await getUserEmail()
    if (!email) return
    const all = await getAllInteractions()
    const unsynced = all.filter(i => !i.synced)
    if (unsynced.length === 0) return
    const supabase = createClient()
    const rows = unsynced.map(i => ({
        user_id: email,
        article_id: i.article_id,
        interaction_type: i.type,
        created_at: i.created_at,
        category: i.category || '',
        category_medium: i.category_medium || '',
        title: i.title || '',
        link: i.link || '',
        dwell_seconds: i.dwell_seconds ?? 0,
        scroll_depth: i.scroll_depth ?? 0,
    }))
    const { error } = await supabase.from('user_interactions').upsert(rows, { onConflict: 'user_id, article_id, interaction_type' })
    if (!error) await markInteractionsSynced(unsynced.map(i => [i.article_id, i.type]))
}

/** 関心ベクトル更新をSupabaseへ（fire-and-forget）。 */
export function pushVector(vector: number[], updatedAt: string): void {
    getUserEmail().then(email => {
        if (!email) return
        const supabase = createClient()
        supabase.from('user_vectors').upsert(
            { user_id: email, vector_m3: vector, updated_at: updatedAt },
            { onConflict: 'user_id' }
        ).then(({ error }) => { if (error) console.warn('pushVector failed:', error.message) })
    })
}

/** 設定（強度・カテゴリON/OFF）をSupabaseへ（fire-and-forget）。 */
export function pushSettings(patch: { filterStrength?: number; excludedCategories?: string[] }): void {
    getUserEmail().then(email => {
        if (!email) return
        const supabase = createClient()
        const row: Record<string, unknown> = { user_id: email, updated_at: new Date().toISOString() }
        if (typeof patch.filterStrength === 'number') row.filter_strength = patch.filterStrength
        if (Array.isArray(patch.excludedCategories)) row.excluded_categories = patch.excludedCategories
        supabase.from('user_profile').upsert(row, { onConflict: 'user_id' })
            .then(({ error }) => { if (error) console.warn('pushSettings failed:', error.message) })
    })
}
