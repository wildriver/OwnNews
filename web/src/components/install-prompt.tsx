'use client'

// 初回ログイン時のオンボーディング（端末に応じた「すぐ開ける化」＋通知の案内）。
// - iOS Safari: ホーム画面に追加（iOSはこれをしないとプッシュ通知が受け取れない）
// - Android/デスクトップのChrome/Edge: ネイティブのインストール（beforeinstallprompt）
// - それ以外（Firefox/デスクトップSafari等）: ブックマーク追加のヒント
// 端末ごとに1回だけ表示し、閉じたら二度と出さない（localStorage）。
// 既にインストール済み(standalone)で通知もオンなら、案内すべきことが無いので出さない。

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Share, Plus, X, Bell, Download, Bookmark, Smartphone } from 'lucide-react'
import { getSubscriptionState, subscribePush } from '@/lib/client/push'

const DISMISS_KEY = 'ownnews_install_dismissed'

// beforeinstallprompt は標準の型定義に無いので最小限だけ定義
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(display-mode: standalone)').matches
        // iOS Safari のホーム画面起動フラグ（型に無いので any 経由）
        || (navigator as unknown as { standalone?: boolean }).standalone === true
}

function isIOS(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /iPhone|iPad|iPod/i.test(ua)
        // iPadOS 13+ は Mac の UA を名乗るのでタッチ数で見分ける
        || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

function isMac(): boolean {
    if (typeof navigator === 'undefined') return false
    return /Mac/i.test(navigator.userAgent)
}

export function InstallPrompt() {
    const [visible, setVisible] = useState(false)
    const [pushBusy, setPushBusy] = useState(false)
    const [pushDone, setPushDone] = useState(false)
    // どのモードで案内するか
    const [mode, setMode] = useState<'ios' | 'native' | 'bookmark' | 'push-only' | null>(null)
    const [pushAvailable, setPushAvailable] = useState(false)
    const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null)

    useEffect(() => {
        // 既に閉じた端末では何もしない
        try { if (localStorage.getItem(DISMISS_KEY)) return } catch { /* noop */ }

        const standalone = isStandalone()
        const ios = isIOS()

        // Chrome/Edge系のネイティブインストール機会を捕捉（発火したらnativeモードに昇格）
        const onBIP = (e: Event) => {
            e.preventDefault()
            deferredPrompt.current = e as BeforeInstallPromptEvent
            setMode(prev => (prev === 'bookmark' ? 'native' : prev))
        }
        window.addEventListener('beforeinstallprompt', onBIP)
        const onInstalled = () => dismiss()
        window.addEventListener('appinstalled', onInstalled)

        // 通知の現状（未購読なら案内対象）。iOSはホーム画面追加後でないと購読できない
        getSubscriptionState().then(state => {
            const canPushNow = state === 'unsubscribed' && (!ios || standalone)
            setPushAvailable(canPushNow)

            let m: typeof mode = null
            if (!standalone) {
                if (ios) m = 'ios'
                else m = deferredPrompt.current ? 'native' : 'bookmark'
            } else if (canPushNow) {
                m = 'push-only'   // 既にインストール済みだが通知は未設定
            }
            if (m) {
                setMode(m)
                // 少し待ってから出す（ログイン直後のちらつきを避ける）
                setTimeout(() => setVisible(true), 1500)
            }
        }).catch(() => { /* 判定不能なら何も出さない */ })

        return () => {
            window.removeEventListener('beforeinstallprompt', onBIP)
            window.removeEventListener('appinstalled', onInstalled)
        }
    }, [])

    const dismiss = () => {
        setVisible(false)
        try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* noop */ }
    }

    const onInstallNative = async () => {
        const dp = deferredPrompt.current
        if (!dp) return
        await dp.prompt()
        const { outcome } = await dp.userChoice
        deferredPrompt.current = null
        if (outcome === 'accepted') dismiss()
    }

    const onEnablePush = async () => {
        setPushBusy(true)
        const r = await subscribePush()
        setPushBusy(false)
        if (r.ok) {
            setPushDone(true)
            toast.success('毎朝のニュース通知をオンにしました')
            setTimeout(dismiss, 1200)
        } else {
            toast.error(r.message)
        }
    }

    if (!visible || !mode) return null

    return (
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:inset-x-auto md:right-4 md:bottom-4 z-50 px-3 md:px-0 pointer-events-none">
            <div className="pointer-events-auto mx-auto md:mx-0 max-w-md md:w-80 bg-card border border-border rounded-2xl shadow-lg p-4 relative">
                <button
                    onClick={dismiss}
                    aria-label="閉じる"
                    className="absolute top-2.5 right-2.5 w-6 h-6 inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="flex items-start gap-2.5 pr-5">
                    <div className="w-8 h-8 rounded-lg bg-primary/12 text-primary flex items-center justify-center shrink-0">
                        <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-[13.5px] font-bold leading-tight">
                            {mode === 'push-only' ? '毎朝のニュースを受け取る' : 'OwnNewsをすぐ開けるように'}
                        </h3>
                        <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
                            {mode === 'ios' && 'ホーム画面に追加すると、アプリのように開けて、毎朝の通知も受け取れます。'}
                            {mode === 'native' && 'アプリとして追加すると、ワンタップで開けて通知も受け取れます。'}
                            {mode === 'bookmark' && 'ブックマークに追加すると、いつでもすぐ開けます。'}
                            {mode === 'push-only' && '新しいニュースが届いたら、毎朝1回だけお知らせします。'}
                        </p>
                    </div>
                </div>

                {/* iOS: ホーム画面追加の手順 */}
                {mode === 'ios' && (
                    <ol className="mt-3 space-y-1.5 text-[12px] text-foreground/90">
                        <li className="flex items-center gap-2">
                            <span className="tnum text-[10px] text-muted-foreground w-4 shrink-0">1.</span>
                            画面下の<Share className="w-3.5 h-3.5 inline text-primary" />共有ボタンを押す
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="tnum text-[10px] text-muted-foreground w-4 shrink-0">2.</span>
                            <span className="inline-flex items-center gap-1">「ホーム画面に追加」<Plus className="w-3.5 h-3.5 inline text-primary" /></span>を選ぶ
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="tnum text-[10px] text-muted-foreground w-4 shrink-0">3.</span>
                            追加したアイコンから開くと、設定→通知でオンにできます
                        </li>
                    </ol>
                )}

                {/* ボタン列 */}
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {mode === 'native' && (
                        <button
                            onClick={onInstallNative}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors"
                        >
                            <Download className="w-3.5 h-3.5" />アプリを追加
                        </button>
                    )}
                    {mode === 'bookmark' && (
                        <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-secondary text-foreground text-[12px] font-medium">
                            <Bookmark className="w-3.5 h-3.5 text-primary" />
                            {isMac() ? '⌘' : 'Ctrl'} + D で追加
                        </span>
                    )}
                    {(pushAvailable && (mode === 'native' || mode === 'bookmark' || mode === 'push-only')) && !pushDone && (
                        <button
                            onClick={onEnablePush}
                            disabled={pushBusy}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
                        >
                            <Bell className="w-3.5 h-3.5" />{pushBusy ? '設定中…' : '通知をオンにする'}
                        </button>
                    )}
                    <button
                        onClick={dismiss}
                        className="h-8 px-2.5 rounded-lg text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ml-auto"
                    >
                        あとで
                    </button>
                </div>
            </div>
        </div>
    )
}
