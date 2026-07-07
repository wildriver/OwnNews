import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

// ローカル推薦エンジン用の「記事パック」を配信する。
//
// 通常経路: article-processor Worker が収集サイクル毎に生成してR2に置いた
//           pack/latest.json を返す（R2はegress無料・CDNキャッシュあり）。
//           Supabaseへのアクセスは発生しない。
// フォールバック: R2バインディング未設定/オブジェクト未生成の場合のみ、
//           Supabaseから直接生成する（開発環境・移行期間用）。

const FULL_PACK_SIZE = 800

// R2バケットの最小限の構造型（@cloudflare/workers-types に依存しない）
interface R2BucketLike {
    get(key: string): Promise<{ text(): Promise<string> } | null>
}

interface PackJson {
    dim: number
    count: number
    generated_at?: string
    latest: string
    articles: { collected_at: string;[key: string]: unknown }[]
}

async function getPackBucket(): Promise<R2BucketLike | null> {
    try {
        // Cloudflare Pages 実行時のみバインディングが存在する
        const { getRequestContext } = await import('@cloudflare/next-on-pages')
        const env = getRequestContext().env as { PACK_BUCKET?: R2BucketLike }
        return env.PACK_BUCKET || null
    } catch {
        return null  // next dev などバインディングのない環境
    }
}

function parseVector(v: unknown): number[] | null {
    if (!v) return null
    if (typeof v === 'string') {
        try { return JSON.parse(v) } catch { return null }
    }
    if (Array.isArray(v)) return v as number[]
    return null
}

// L2正規化してint8量子化 → base64（フォールバック生成用。Worker側と同一ロジック）
function quantizeToBase64(vec: number[]): string | null {
    const n = vec.length
    if (n === 0) return null
    let norm = 0
    for (let i = 0; i < n; i++) norm += vec[i] * vec[i]
    norm = Math.sqrt(norm)
    if (norm === 0) return null

    const bytes = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
        const q = Math.max(-127, Math.min(127, Math.round((vec[i] / norm) * 127)))
        bytes[i] = q & 0xff
    }
    let binary = ''
    const CHUNK = 8192
    for (let i = 0; i < n; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
}

const CACHE_HEADERS = {
    // CDNで10分キャッシュ。収集は1日5回なので十分な鮮度
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
}

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url)
    const since = searchParams.get('since')  // ISO8601: 差分取得用

    // ---- 通常経路: R2上の事前生成パック ----
    const bucket = await getPackBucket()
    if (bucket) {
        try {
            const obj = await bucket.get('pack/latest.json')
            if (obj) {
                const text = await obj.text()
                if (!since) {
                    return new NextResponse(text, {
                        headers: { 'Content-Type': 'application/json', ...CACHE_HEADERS },
                    })
                }
                // 差分リクエスト: パック内でフィルタして返す
                const pack: PackJson = JSON.parse(text)
                const delta = pack.articles.filter(a => a.collected_at > since)
                return NextResponse.json(
                    { ...pack, count: delta.length, articles: delta },
                    { headers: CACHE_HEADERS }
                )
            }
        } catch (e) {
            console.error('R2 pack read failed, falling back to Supabase:', e)
        }
    }

    // ---- フォールバック: Supabaseから直接生成 ----
    const supabase = await createClient()

    let query = supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, source, fact_score, context_score, perspective_score, emotion_score, immediacy_score, collected_at, embedding_m3')
        .not('embedding_m3', 'is', null)
        .order('collected_at', { ascending: false })
        .limit(FULL_PACK_SIZE)

    if (since) {
        query = query.gt('collected_at', since)
    }

    const { data, error } = await query
    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    let latestCollectedAt = since || ''
    const articles = (data || []).map((a) => {
        const vec = parseVector(a.embedding_m3)
        if (a.collected_at > latestCollectedAt) latestCollectedAt = a.collected_at
        return {
            id: a.id,
            title: a.title,
            link: a.link,
            summary: (a.summary || '').slice(0, 300),
            published: a.published,
            category: a.category,
            category_medium: a.category_medium,
            category_minor: a.category_minor,
            image_url: a.image_url,
            source: a.source,
            fact_score: a.fact_score,
            context_score: a.context_score,
            perspective_score: a.perspective_score,
            emotion_score: a.emotion_score,
            immediacy_score: a.immediacy_score,
            collected_at: a.collected_at,
            emb: vec ? quantizeToBase64(vec) : null,
        }
    })

    return NextResponse.json(
        {
            dim: 1024,
            count: articles.length,
            latest: latestCollectedAt,
            articles,
        },
        { headers: CACHE_HEADERS }
    )
}
