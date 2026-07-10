import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

// はてなブックマークのエントリ情報プロキシ。
// jsonliteエンドポイントはCORSがb.hatena.ne.jp限定のため、エッジで中継する。
// 認証不要・無料のAPIで、記事URLへのブクマ数とコメントが取れる
// （「この記事がどう受け止められているか」のシグナルとしてアプリ内表示に使う）。

interface HatenaBookmark {
    user: string
    comment: string
    timestamp: string
    tags: string[]
}

interface HatenaEntry {
    count?: number
    entry_url?: string
    bookmarks?: HatenaBookmark[]
}

const CACHE_HEADERS = {
    // CDNで10分キャッシュ（ブクマの反映は多少遅れてよい）
    'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
}

export async function GET(req: NextRequest) {
    const url = req.nextUrl.searchParams.get('url') || ''
    if (!/^https?:\/\//.test(url)) {
        return NextResponse.json({ error: 'invalid url' }, { status: 400 })
    }

    try {
        const res = await fetch(
            `https://b.hatena.ne.jp/entry/jsonlite/?url=${encodeURIComponent(url)}`,
            { headers: { 'User-Agent': 'OwnNews/1.0' } }
        )
        if (!res.ok) throw new Error(`hatena ${res.status}`)

        // ブクマが1件も無いURLは "null" が返る
        const entry = (await res.json()) as HatenaEntry | null
        if (!entry) {
            return NextResponse.json({ count: 0, entry_url: null, comments: [] }, { headers: CACHE_HEADERS })
        }

        // コメント付きのみ・新しい順・最大10件に絞って返す（転送量削減）
        const comments = (entry.bookmarks ?? [])
            .filter(b => (b.comment || '').trim() !== '')
            .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
            .slice(0, 10)
            .map(b => ({ user: b.user, comment: b.comment, timestamp: b.timestamp }))

        return NextResponse.json(
            { count: entry.count ?? 0, entry_url: entry.entry_url ?? null, comments },
            { headers: CACHE_HEADERS }
        )
    } catch {
        // 失敗時は「情報なし」として返す（記事表示は妨げない）
        return NextResponse.json({ count: 0, entry_url: null, comments: [] }, { headers: CACHE_HEADERS })
    }
}
