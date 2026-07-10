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
}

export interface AdminData {
    summary: AdminSummary
    daily: DailyActivity[]
    categories: CategoryShare[]
    filterHistogram: FilterBucket[]
    users: UserDetail[]
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
    const [summary, daily, categories, filterHistogram, users] = await Promise.all([
        supabase.rpc('admin_summary'),
        supabase.rpc('admin_daily_activity', { days }),
        supabase.rpc('admin_category_distribution'),
        supabase.rpc('admin_filter_histogram'),
        supabase.rpc('admin_user_detail'),
    ])

    // どれか一つでも認可エラーなら管理者ではない（or 未適用）
    if (summary.error || daily.error || categories.error || filterHistogram.error || users.error) {
        return null
    }

    return {
        summary: summary.data as AdminSummary,
        daily: (daily.data ?? []) as DailyActivity[],
        categories: (categories.data ?? []) as CategoryShare[],
        filterHistogram: (filterHistogram.data ?? []) as FilterBucket[],
        users: (users.data ?? []) as UserDetail[],
    }
}
