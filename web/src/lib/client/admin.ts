'use client'

// 管理者ダッシュボード用のデータ取得。
// 認証済みの匿名キー（ユーザーのGoogleログインJWT）で、運営向けの集計RPCを呼ぶ。
// RPCはSupabase側で SECURITY DEFINER + is_admin() ガードされており、
// admin_users に登録された運営以外が呼ぶと 'not authorized' 例外になる。
// → クライアントにservice_roleキーを一切置かずに「運営だけ」観測できる。

import { createClient } from '@/lib/supabase/client'

export interface AdminSummary {
    total_users: number
    active_7d: number
    active_30d: number
    total_views: number
    total_deep_dives: number
    total_dismissed: number
    push_subscribers: number
    avg_filter_strength: number | null
    avg_dwell_sec: number | null
    // もっと知る（AI深掘り／X／はてブ）と検索利用。RPC未適用時は undefined。
    know_ai?: number
    know_x?: number
    know_hatena?: number
    search_7d?: number
    search_30d?: number
}

export interface DailyActivity {
    day: string
    views: number
    active_users: number
}

export interface CategoryShare {
    category: string
    views: number
}

export interface FilterBucket {
    bucket: string
    cnt: number
}

export interface UserDetail {
    user_id: string
    filter_strength: number | null
    views: number
    deep_dives: number
    dismissed: number
    last_active: string | null
    top_category: string | null
    top_ratio: number | null
    // 追加（RPC未適用時は undefined）
    know_more?: number
    searches_30d?: number
    watched_tags_count?: number
}

export interface UserCategoryCell {
    user_id: string
    category: string
    views: number
}

export interface WatchedTagAgg {
    tag: string
    subscribers: number
}

export interface AdminData {
    summary: AdminSummary
    daily: DailyActivity[]
    categories: CategoryShare[]
    filterHistogram: FilterBucket[]
    users: UserDetail[]
    /** ユーザー×ジャンルの閲覧行列。RPC未適用（migrate_admin_viz.sql）なら null。 */
    matrix: UserCategoryCell[] | null
    /** 関心キーワード（ウォッチタグ）→購読者数。RPC未適用なら null。 */
    watchedTags: WatchedTagAgg[] | null
}

/**
 * 表示用の匿名ID（決定的ハッシュ・FNV-1a）。
 * 管理画面にメールアドレスを出さないための匿名加工。同じユーザーは常に同じIDになる
 * ので経過観察はできるが、IDから個人は特定できない。
 */
export function anonUser(userId: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < userId.length; i++) {
        h ^= userId.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return 'U-' + h.toString(36).toUpperCase().padStart(4, '0').slice(0, 4)
}

/** ログイン中ユーザーが運営（管理者）かどうか。 */
export async function checkIsAdmin(): Promise<boolean> {
    const supabase = createClient()
    const { data, error } = await supabase.rpc('is_admin')
    if (error) return false
    return data === true
}

/**
 * 管理ダッシュボードの全データを一括取得。
 * 非管理者や未ログインの場合は RPC が例外を返すので null を返す。
 */
export async function fetchAdminData(days = 30): Promise<AdminData | null> {
    const supabase = createClient()
    const [summary, daily, categories, filterHistogram, users, matrix, watchedTags] = await Promise.all([
        supabase.rpc('admin_summary'),
        supabase.rpc('admin_daily_activity', { days }),
        supabase.rpc('admin_category_distribution'),
        supabase.rpc('admin_filter_histogram'),
        supabase.rpc('admin_user_detail'),
        supabase.rpc('admin_user_category_matrix'),
        supabase.rpc('admin_watched_tags'),
    ])

    // どれか一つでも認可エラーなら管理者ではない（or 未適用）
    // matrix / watchedTags は後から追加したRPCなので、未適用でもページ全体は生かす
    if (summary.error || daily.error || categories.error || filterHistogram.error || users.error) {
        return null
    }

    return {
        summary: summary.data as AdminSummary,
        daily: (daily.data ?? []) as DailyActivity[],
        categories: (categories.data ?? []) as CategoryShare[],
        filterHistogram: (filterHistogram.data ?? []) as FilterBucket[],
        users: (users.data ?? []) as UserDetail[],
        matrix: matrix.error ? null : ((matrix.data ?? []) as UserCategoryCell[]),
        watchedTags: watchedTags.error ? null : ((watchedTags.data ?? []) as WatchedTagAgg[]),
    }
}
