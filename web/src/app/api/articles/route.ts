import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20')), 50)
  const category = searchParams.get('category') || null
  const excludeParam = searchParams.get('exclude') || null
  const excluded = excludeParam ? excludeParam.split(',').map(s => s.trim()).filter(Boolean) : []

  let query = supabase
    .from('articles')
    .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
    .order('collected_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) {
    query = query.like('category', `%${category}%`)
  }

  // Exclude specific categories via NOT LIKE for each
  for (const cat of excluded) {
    query = query.not('category', 'like', `%${cat}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const articles = data || []
  return NextResponse.json({
    articles,
    hasMore: articles.length === limit,
  })
}
