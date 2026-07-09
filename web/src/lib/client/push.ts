'use client'

// Web Push の購読管理（クライアント）
// 通知許可 → PushManagerで購読 → 購読情報を運営Supabaseに保存。
// 送信はWorkerが日次で行う。

import { createClient } from '@/lib/supabase/client'
import { getUserEmail } from './sync'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

export function pushSupported(): boolean {
    return typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
}

/** VAPID公開鍵(base64url)をUint8Arrayへ（PushManagerのapplicationServerKey用） */
function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(b64)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
    const existing = await navigator.serviceWorker.getRegistration()
    return existing || navigator.serviceWorker.register('/sw.js')
}

export async function getSubscriptionState(): Promise<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'> {
    if (!pushSupported() || !VAPID_PUBLIC_KEY) return 'unsupported'
    if (Notification.permission === 'denied') return 'denied'
    try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        return sub ? 'subscribed' : 'unsubscribed'
    } catch {
        return 'unsubscribed'
    }
}

/** 通知を有効化（許可要求→購読→Supabase保存）。成功でtrue。 */
export async function subscribePush(): Promise<{ ok: boolean; message: string }> {
    if (!pushSupported()) return { ok: false, message: 'この端末/ブラウザは通知に対応していません' }
    if (!VAPID_PUBLIC_KEY) return { ok: false, message: '通知の設定（VAPIDキー）が未構成です' }

    const email = await getUserEmail()
    if (!email) return { ok: false, message: 'ログインが必要です' }

    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, message: '通知が許可されませんでした' }

    try {
        const reg = await getRegistration()
        await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        })
        const json = sub.toJSON()
        const supabase = createClient()
        const { error } = await supabase.from('push_subscriptions').upsert({
            user_id: email,
            endpoint: sub.endpoint,
            p256dh: json.keys?.p256dh || '',
            auth: json.keys?.auth || '',
            user_agent: navigator.userAgent.slice(0, 200),
        }, { onConflict: 'endpoint' })
        if (error) return { ok: false, message: `保存に失敗: ${error.message}` }
        return { ok: true, message: '通知をオンにしました' }
    } catch (e) {
        return { ok: false, message: `購読に失敗しました: ${String(e)}` }
    }
}

/** 通知を無効化（購読解除＋Supabaseから削除） */
export async function unsubscribePush(): Promise<{ ok: boolean; message: string }> {
    try {
        const reg = await navigator.serviceWorker.getRegistration()
        const sub = reg ? await reg.pushManager.getSubscription() : null
        if (sub) {
            const endpoint = sub.endpoint
            await sub.unsubscribe()
            const supabase = createClient()
            await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
        }
        return { ok: true, message: '通知をオフにしました' }
    } catch (e) {
        return { ok: false, message: `解除に失敗しました: ${String(e)}` }
    }
}
