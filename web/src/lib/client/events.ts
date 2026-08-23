'use client'

// 観察研究のためのUXイベント記録。
// 記録するのは「操作したという事実」だけで、記事の中身や関心ベクトルは含めない。
// 送信先は運営Supabase（本人のみRLS）で、第三者の解析サービスには一切送らない。
//
// 何のために取るか:
//   filter_change … 「状況に応じて強度を変えたか」＝主要評価指標。現在値の上書き
//                   保存では変動が消えるため、from→to を確定時に1件だけ残す。
//   impression    … 率の分母。触った人だけでなく「見た人」が分からないと
//                   「スライダーに触れた利用者の割合」が計算できない。

import { getUserEmail } from './sync'
import { createClient } from '@/lib/supabase/client'

export type Surface =
    | 'slider' | 'dashboard' | 'missed_news'
    | 'in_bubble' | 'outside_bubble' | 'topic' | 'search' | 'watched' | 'direct'

type EventType = 'filter_change' | 'impression' | 'open'

interface UxEvent {
    event_type: EventType
    surface?: Surface
    value_from?: number
    value_to?: number
    meta?: Record<string, unknown>
    client_at: string
}

function send(e: UxEvent): void {
    getUserEmail().then(email => {
        if (!email) return   // 未ログインでは記録しない（本人に紐付かない行を作らない）
        createClient().from('ux_events').insert({ user_id: email, ...e })
            .then(({ error }) => { if (error) console.warn('ux_event failed:', error.message) })
    }).catch(() => { /* 計測失敗で本体を止めない */ })
}

/** スライダーを操作した場所。読んでいる最中の文脈内探索(feed)と、
 *  腰を据えた設定変更(settings)は別の行動なので区別して記録する。 */
export type FilterPlace = 'feed' | 'settings'

/** スライダーの確定値を1件記録する。方向（広げた/狭めた）が復元できるよう from も残す。 */
export function logFilterChange(from: number, to: number, place: FilterPlace): void {
    if (from === to) return
    send({
        event_type: 'filter_change', surface: 'slider',
        value_from: from, value_to: to, meta: { place },
        client_at: new Date().toISOString(),
    })
}

/**
 * 面が実際に画面に出たことを記録する（率の分母）。
 * 重複排除は「1日1面1件」。セッション単位にするとリロードのたびに増えて
 * 行数が利用者の癖に依存するため、1人あたりの上限を日次で固定する
 * （面の数 × 日数 が上限。容量見積りが立つ）。
 */
const impressed = new Set<string>()
export function logImpression(surface: Surface, meta?: Record<string, unknown>): void {
    const day = new Date().toISOString().slice(0, 10)
    const key = `${day}|${surface}`
    if (impressed.has(key)) return
    impressed.add(key)
    try {
        const k = `ownnews_imp_${key}`
        if (localStorage.getItem(k)) return
        localStorage.setItem(k, '1')
    } catch { /* localStorage不可でもセッション内重複は防げている */ }
    send({ event_type: 'impression', surface, meta, client_at: new Date().toISOString() })
}

// ---- クリックの出自 ----
// どの面から開いた記事かが無いと「バブルの外を実際に読んだ」と言えない。
// カードのクリック時に面を控えておき、遷移先の記事詳細が閲覧記録に添える。
// sessionStorage を使うのはページ遷移をまたぐため（モジュール変数は消える）。

const SURFACE_KEY = 'ownnews_open_surface'

export function noteOpenSurface(articleId: string, surface: Surface): void {
    try { sessionStorage.setItem(SURFACE_KEY, JSON.stringify({ articleId, surface })) } catch { /* noop */ }
}

/** 直前のクリックで控えた面を取り出す。別記事のものなら 'direct'（直リンク・通知経由）。 */
export function takeOpenSurface(articleId: string): Surface {
    try {
        const raw = sessionStorage.getItem(SURFACE_KEY)
        if (!raw) return 'direct'
        const v = JSON.parse(raw) as { articleId: string; surface: Surface }
        return v.articleId === articleId ? v.surface : 'direct'
    } catch { return 'direct' }
}

/** rAF連続発火のスライダー向け。離してから確定した値だけを1件にまとめる。 */
export function makeFilterChangeLogger(place: FilterPlace, settleMs = 400) {
    let base: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    return (from: number, to: number) => {
        if (base === null) base = from      // ドラッグ開始時の値を掴んでおく
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            if (base !== null) logFilterChange(base, to, place)
            base = null
            timer = null
        }, settleMs)
    }
}
