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
    getAllInteractions, markInteractionsSynced, putInteraction, deleteInteractions, setKV, getKV, clearAll,
} from './store'
import { loadExcluded } from '@/components/category-filter-bar'
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
// watched_tags はKVへ直接反映するため RemoteState には含めない

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
            supabase.from('user_profile').select('filter_strength, excluded_categories, watched_tags, updated_at').eq('user_id', email).maybeSingle(),
            supabase.from('user_vectors').select('vector_m3, updated_at').eq('user_id', email).maybeSingle(),
            supabase.from('user_interactions')
                .select('article_id, interaction_type, created_at, category, category_medium, title, link, dwell_seconds, scroll_depth')
                .eq('user_id', email)
                .order('created_at', { ascending: false })
                .limit(2000),
        ])

        // リモート操作履歴をローカルキャッシュへ反映（リモートを真実として突き合わせ）
        if (remoteInts) {
            const local = await getAllInteractions()
            const remoteKeys = new Set(remoteInts.map(r => `${r.article_id}|${r.interaction_type}`))
            // 未pushのローカル操作は保持（サーバーにまだ無いだけ）
            const localUnsyncedKeys = new Set(local.filter(l => !l.synced).map(l => `${l.article_id}|${l.type}`))

            // 1) サーバーから消えた同期済みローカル行を削除（サーバー側削除を反映）。
            //    ただしpullは最新2000件までなので、それ以前の「窓の外」は誤削除しない。
            const windowed = remoteInts.length >= 2000
            const oldestRemote = remoteInts.length ? remoteInts[remoteInts.length - 1].created_at : ''
            const toDelete = local
                .filter(l => l.synced
                    && !remoteKeys.has(`${l.article_id}|${l.type}`)
                    && !(windowed && l.created_at < oldestRemote))
                .map(l => [l.article_id, l.type] as [string, string])
            await deleteInteractions(toDelete)

            // 2) リモート行を取り込み（同期済みローカルは上書き＝タイトル補完等を反映。
            //    未pushのローカルは温存）
            for (const r of remoteInts) {
                const key = `${r.article_id}|${r.interaction_type}`
                if (localUnsyncedKeys.has(key)) continue
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

        // ---- 関心ベクトル: 新しい方が勝つ（last-write-wins） ----
        // 以前は無条件にリモートで上書きしていたため、端末側のリセットや直近の学習が
        // 古いリモートで巻き戻る不具合があった。更新時刻を比較して解決する。
        const remoteVector = parseVector(vecRow?.vector_m3)
        const localVts = (await getKV<string>('vector_updated_at')) || ''
        const remoteVts = vecRow?.updated_at || ''
        let vector: number[] | null = null
        if (remoteVector && (!localVts || remoteVts > localVts)) {
            // リモートが新しい → 取り込む
            vector = remoteVector
            await setKV('user_vector', vector)
            if (remoteVts) await setKV('vector_updated_at', remoteVts)
        } else if (localVts && remoteVts && localVts > remoteVts) {
            // ローカルが新しい → リモートを直す（過去のpush失敗の自己修復）
            const localVec = await getKV<number[]>('user_vector')
            if (localVec) {
                pushVector(localVec, localVts)
            } else {
                // ローカルで「リセット」済み → リモートの残骸を削除（リセットの復活防止）
                deleteRemoteVector()
            }
        }

        // ---- 設定（強度・除外ジャンル）: 同じく新しい方が勝つ ----
        const localSts = (await getKV<string>('settings_updated_at')) || ''
        const remoteSts = profile?.updated_at || ''
        const applyRemoteSettings = !!remoteSts && (!localSts || remoteSts > localSts)
        if (applyRemoteSettings && typeof profile?.filter_strength === 'number') {
            await setKV('filter_strength', profile.filter_strength)
        }
        if (applyRemoteSettings && Array.isArray(profile?.watched_tags)) {
            await setKV('watched_tags', profile!.watched_tags)
        }
        if (!applyRemoteSettings && localSts && remoteSts && localSts > remoteSts) {
            // ローカルが新しい → リモートを直す
            const fs = await getKV<number>('filter_strength')
            const wt = await getKV<string[]>('watched_tags')
            pushSettings({
                ...(typeof fs === 'number' ? { filterStrength: fs } : {}),
                excludedCategories: Array.from(loadExcluded()),
                ...(Array.isArray(wt) ? { watchedTags: wt } : {}),
            })
        }

        // 未同期のローカル操作をpush
        await pushUnsyncedInteractions()

        // 履歴・ダッシュボード等に「取り込み完了」を通知
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(SYNCED_EVENT))
        }

        return {
            vector,   // リモート採用時のみ非null（ローカルが新しければnull=そのまま）
            filterStrength: applyRemoteSettings && typeof profile?.filter_strength === 'number' ? profile.filter_strength : null,
            excludedCategories: applyRemoteSettings && Array.isArray(profile?.excluded_categories) ? profile!.excluded_categories : null,
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

/** 操作1件をSupabaseから削除（ストック解除など）。fire-and-forget。 */
export function deleteRemoteInteraction(articleId: string, type: InteractionType): void {
    getUserEmail().then(email => {
        if (!email) return
        const supabase = createClient()
        supabase.from('user_interactions').delete()
            .eq('user_id', email).eq('article_id', articleId).eq('interaction_type', type)
            .then(({ error }) => { if (error) console.warn('deleteRemoteInteraction failed:', error.message) })
    })
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

/** 設定（強度・カテゴリON/OFF）をSupabaseへ。ローカルにも更新時刻を記録（last-write-wins用）。 */
export function pushSettings(patch: { filterStrength?: number; excludedCategories?: string[]; watchedTags?: string[] }): Promise<boolean> {
    const now = new Date().toISOString()
    // 変更の事実を先にローカルへ刻む（push失敗時もリモートの古い値で巻き戻らない）
    setKV('settings_updated_at', now)
    return getUserEmail().then(email => {
        if (!email) return false
        const supabase = createClient()
        const row: Record<string, unknown> = { user_id: email, updated_at: now }
        if (typeof patch.filterStrength === 'number') row.filter_strength = patch.filterStrength
        if (Array.isArray(patch.excludedCategories)) row.excluded_categories = patch.excludedCategories
        if (Array.isArray(patch.watchedTags)) row.watched_tags = patch.watchedTags
        return supabase.from('user_profile').upsert(row, { onConflict: 'user_id' })
            .then(({ error }) => {
                if (error) console.warn('pushSettings failed:', error.message)
                return !error
            })
    }).catch(() => false)
}

/** リモートの関心ベクトルを削除（リセットの完成形。これが無いと同期で復活する）。 */
export function deleteRemoteVector(): Promise<boolean> {
    return getUserEmail().then(email => {
        if (!email) return false
        const supabase = createClient()
        return supabase.from('user_vectors').delete().eq('user_id', email)
            .then(({ error }) => {
                if (error) console.warn('deleteRemoteVector failed:', error.message)
                return !error
            })
    }).catch(() => false)
}
