import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
    try {
        return await updateSession(request)
    } catch (e) {
        // If Supabase fails (e.g. missing env vars), allow the request to proceed
        // for public routes or debug page. Protected routes will handle auth checks
        // in the page component or layout if middleware fails.
        // Also logging the error might be useful if we had a logger.
        console.error('Middleware error:', e);
        return NextResponse.next({
            request: {
                headers: request.headers,
            },
        })
    }
}

export const config = {
    matcher: [
        /*
         * 認証セッションの更新（updateSession）を走らせる対象。
         * 除外するもの:
         * - _next/static, _next/image, favicon.ico, 画像ファイル（静的アセット）
         * - api/pack, api/latest, api/hatena: 認証不要の公開ルート。特にapi/packは
         *   5分ごとにポーリングされるため、ここでセッション更新（getUser→トークン
         *   ローテーション→Set-Cookie）を走らせると、ブラウザ側の更新と競合して
         *   セッションが無効化されやすい。認証が要る api/interact, api/articles は対象に残す。
         * - sw.js, manifest.json: セッションと無関係
         */
        '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|api/pack|api/latest|api/hatena|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
