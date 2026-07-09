import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { stripHtml } from '@/lib/news'

export const runtime = 'edge'

// ローカル推薦エンジン用の「記事パック」を配信する。
//
// 通常経路: article-processor Worker が収集サイクル毎に生成してR2に置いた
//           pack/latest.json を返す（R2はegress無料・CDNキャッシュあり）。
//           Supabaseへのアクセスは発生しない。
// フォールバック: R2バインディング未設定/オブジェクト未生成の場合のみ、
//           Supabaseから直接生成する（開発環境・移行期間用）。

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
    // 注意: Supabaseの匿名ロールにはstatement timeout（約3秒）がある。
    // ここでは embedding_m3 IS NOT NULL で絞り込まない:
    //   - 絞り込むと、埋め込み未生成の記事が多い間は全件スキャンになりタイムアウトする
    //   - 埋め込みが無くてもニュース自体は表示したい（バブル分類は後から効く）
    // collected_at のインデックスに沿って最新から取得するので高速。
    // embedding_m3 は重いので取得列から外し、埋め込みはR2パック経由でのみ配る。
    const supabase = await createClient()

    const PAGE = 100
    const MAX_PAGES = 4  // フォールバックは最大400件（R2復旧までのつなぎ）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = []
    let queryError: string | null = null

    for (let i = 0; i < MAX_PAGES; i++) {
        let query = supabase
            .from('articles')
            .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, source, fact_score, context_score, perspective_score, emotion_score, immediacy_score, collected_at')
            .order('collected_at', { ascending: false })
            .range(i * PAGE, i * PAGE + PAGE - 1)

        if (since) {
            query = query.gt('collected_at', since)
        }

        const { data: page, error } = await query
        if (error) {
            queryError = error.message
            break
        }
        data.push(...(page || []))
        if (!page || page.length < PAGE) break
    }

    if (data.length === 0 && queryError) {
        return NextResponse.json({ error: queryError }, { status: 500 })
    }

    let latestCollectedAt = since || ''
    const articles = (data || []).map((a) => {
        if (a.collected_at > latestCollectedAt) latestCollectedAt = a.collected_at
        return {
            id: a.id,
            title: a.title,
            link: a.link,
            summary: stripHtml(a.summary || '').slice(0, 300),
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
            // フォールバック経路では埋め込みを返さない（重い & タイムアウト回避）。
            // 埋め込み付きの本来のパックはWorkerがR2に生成する。
            emb: null,
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
