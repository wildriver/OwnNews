import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// ブラウザ用Supabaseクライアントは「1タブに1つ」に固定する（シングルトン）。
// 以前は呼び出しのたびに新規生成していたため、sync/push/reactions/watched-tags/
// usage/admin など各所が独立したGoTrueインスタンスを持ち、それぞれが裏で
// トークン自動更新を走らせていた。複数インスタンスが同じリフレッシュトークンを
// 同時に使うと "refresh token already used" でセッションが無効化され、
// 頻繁な再ログインの原因になっていた。1インスタンスに集約すると更新が
// 単一ロックで直列化され、この競合が起きなくなる。
let browserClient: SupabaseClient | undefined

export function createClient(): SupabaseClient {
    if (browserClient) return browserClient
    browserClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    return browserClient
}
