import { NextResponse } from 'next/server'

export const runtime = 'edge'

// Service Workerがプッシュ受信時に叩く軽量エンドポイント。
// 記事パック（R2 or Supabaseフォールバック）から件数と最新見出しだけ返す。
// 認証不要（記事は公開データ）。

interface R2BucketLike { get(key: string): Promise<{ text(): Promise<string> } | null> }

async function getPackBucket(): Promise<R2BucketLike | null> {
    try {
        const { getRequestContext } = await import('@cloudflare/next-on-pages')
        const env = getRequestContext().env as { PACK_BUCKET?: R2BucketLike }
        return env.PACK_BUCKET || null
    } catch {
        return null
    }
}

export async function GET() {
    try {
        const bucket = await getPackBucket()
        if (bucket) {
            const obj = await bucket.get('pack/latest.json')
            if (obj) {
                const pack = JSON.parse(await obj.text())
                const arts = pack.articles || []
                return NextResponse.json(
                    { count: arts.length, latestTitle: arts[0]?.title || '', date: pack.latest || '' },
                    { headers: { 'Cache-Control': 'public, s-maxage=300' } }
                )
            }
        }
    } catch { /* fall through */ }
    return NextResponse.json({ count: 0, latestTitle: '', date: '' })
}
