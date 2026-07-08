import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

// 記事1件の軽量取得（キャッシュ未ヒット時のフォールバック専用）。
// 埋め込み(embedding_m3)は返さない＝軽量・高速。関連記事の類似度計算は
// クライアント側で端末内のパックを使って行うため、ここでは単体メタのみ。
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, source, fact_score, context_score, perspective_score, emotion_score, immediacy_score, collected_at')
        .eq('id', id)
        .single()

    if (error || !data) {
        return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' },
    })
}
