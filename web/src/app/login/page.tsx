'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

// iOSラッパーアプリとのSign in with Appleブリッジ。
// アプリ側(WKWebView)が appleSignIn メッセージハンドラを提供し、
// ネイティブ認証の結果(identityToken+nonce)をコールバックで返してくる。
declare global {
    interface Window {
        webkit?: {
            messageHandlers?: {
                appleSignIn?: { postMessage: (msg: unknown) => void }
            }
        }
        __onAppleSignIn?: (payload: { token: string; nonce: string }) => void
        __onAppleSignInError?: () => void
    }
}

export default function LoginPage() {
    // iOSラッパーアプリ内かどうか。true ならネイティブのSign in with Appleを、
    // false（通常のブラウザ）なら Supabase 経由のOAuthフローを使う。
    // どちらの経路でも Apple 側は同じユーザーとして扱われるため（Services IDの
    // Primary App ID をアプリの App ID に設定してあることが前提）、iPhoneとPCで
    // 同じアカウントになり履歴が同期される。
    const [isNativeApp, setIsNativeApp] = useState(false)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setIsNativeApp(
            navigator.userAgent.includes('OwnNewsApp')
            && !!window.webkit?.messageHandlers?.appleSignIn
        )
    }, [])

    const handleLogin = async () => {
        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        })

        if (error) {
            toast.error('ログインに失敗しました', {
                description: error.message,
            })
        }
    }

    const handleAppleLogin = () => {
        // 通常のブラウザ: SupabaseのOAuthフロー（Services ID + クライアントシークレット）
        if (!isNativeApp) {
            setBusy(true)
            const supabase = createClient()
            supabase.auth.signInWithOAuth({
                provider: 'apple',
                options: { redirectTo: `${window.location.origin}/auth/callback` },
            }).then(({ error }) => {
                if (error) {
                    setBusy(false)
                    toast.error('ログインに失敗しました', { description: error.message })
                }
                // 成功時はAppleへリダイレクトするので、busyは解除しない
            })
            return
        }

        // iOSアプリ内: ネイティブのSign in with Apple（ブリッジ経由）
        setBusy(true)
        window.__onAppleSignIn = async ({ token, nonce }) => {
            const supabase = createClient()
            const { error } = await supabase.auth.signInWithIdToken({
                provider: 'apple',
                token,
                nonce,
            })
            setBusy(false)
            if (error) {
                toast.error('ログインに失敗しました', { description: error.message })
            } else {
                window.location.href = '/'
            }
        }
        window.__onAppleSignInError = () => {
            setBusy(false)
            toast.error('Appleでのログインに失敗しました')
        }
        window.webkit?.messageHandlers?.appleSignIn?.postMessage({})
        // ネイティブダイアログがキャンセルされたときのためにボタンを復帰させる
        setTimeout(() => setBusy(false), 30000)
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md border-border bg-card relative z-10 shadow-sm">
                <CardHeader className="text-center">
                    <CardTitle className="text-2xl font-bold text-primary">
                        OwnNews
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                        情報的健康を保つニュースリーダー
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-[13px] text-center text-zinc-700 leading-relaxed">
                        アカウントでログインすると、あなたの関心に合わせた
                        ニュースがパソコン・スマホで同期されます。
                    </p>

                    {/* Appleでサインインはアプリ・ブラウザの両方で表示する。
                        経路は異なる（アプリ=ネイティブ / ブラウザ=OAuth）が、
                        Apple側では同一ユーザーになるため端末間で履歴が同期される。 */}
                    <Button
                        className="w-full h-12 bg-black text-white hover:bg-black/85 transition-all duration-300"
                        onClick={handleAppleLogin}
                        disabled={busy}
                    >
                        <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <path d="M17.05 20.28c-.98.95-2.05.86-3.08.38-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.38C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                        </svg>
                        Appleでサインイン
                    </Button>

                    <Button
                        variant="outline"
                        className="w-full h-12 border-border hover:bg-secondary hover:text-foreground transition-all duration-300 group"
                        onClick={handleLogin}
                    >
                        <svg className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" viewBox="0 0 24 24">
                            <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                fill="#4285F4"
                            />
                            <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                            />
                            <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                            />
                            <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                            />
                        </svg>
                        Googleでログイン
                    </Button>

                    <p className="text-center">
                        <a href="/welcome" className="text-[12px] text-muted-foreground hover:text-primary transition-colors">
                            OwnNewsとは？ — サービス紹介を見る
                        </a>
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
