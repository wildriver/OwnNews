'use client'

// 匿名の利用イベント記録（検索回数など）。
// 「何回使ったか」だけを運営Supabaseへ送る。検索語などの中身は絶対に送らない。
// bump_usage_event RPC は呼び出し者自身の行だけをRLS下でインクリメントする。

import { createClient } from '@/lib/supabase/client'

// 同一イベントの連打を抑える（メモリ内スロットル。60秒に1回まで）。
const THROTTLE_MS = 60_000
const lastSent = new Map<string, number>()

/**
 * 利用イベントを1件記録する（fire-and-forget）。
 * - 未ログイン時はRPC側で何もしない（uid=null）。
 * - 失敗は console.warn のみ（利用体験を妨げない）。
 * - 検索語などの中身は引数に含めない設計（eventキーだけ）。
 */
export function bumpUsageEvent(event: string): void {
    const now = Date.now()
    const prev = lastSent.get(event) ?? 0
    if (now - prev < THROTTLE_MS) return
    lastSent.set(event, now)

    try {
        const supabase = createClient()
        supabase.rpc('bump_usage_event', { p_event: event }).then(({ error }) => {
            if (error) console.warn('bumpUsageEvent failed:', error.message)
        })
    } catch (e) {
        console.warn('bumpUsageEvent failed:', e)
    }
}
