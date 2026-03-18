import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BubbleFeedLayout } from '@/components/bubble-feed-layout'
import { FilterSlider } from '@/components/filter-slider'
import { groupSimilarArticles } from '@/lib/news'
import { Article, GroupedArticle } from '@/lib/types'
import { Suspense } from 'react'

export const runtime = 'edge'

// Similarity threshold: above = in-bubble, below = out-of-bubble
const BUBBLE_THRESHOLD = 0.65
// Max articles per zone
const ZONE_SIZE = 15

function parseVector(v: unknown): number[] | null {
  if (!v) return null
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return null }
  }
  if (Array.isArray(v)) return v as number[]
  return null
}

function stripEmbeddings(articles: GroupedArticle[]): GroupedArticle[] {
  return articles.map(a => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { embedding_m3, embedding, ...rest } = a as unknown as Record<string, unknown>
    return {
      ...rest,
      related: a.related?.map(r => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { embedding_m3: _e, embedding: _em, ...rRest } = r as unknown as Record<string, unknown>
        return rRest as unknown as Article
      }),
    } as GroupedArticle
  })
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const selectedCategory = typeof params?.category === 'string' ? params.category.trim() : null
  const dateFrom = typeof params?.dateFrom === 'string' ? params.dateFrom.trim() : null
  const dateTo = typeof params?.dateTo === 'string' ? params.dateTo.trim() : null
  const hasDateFilter = !!(dateFrom || dateTo)

  let user = null
  let inBubbleArticles: GroupedArticle[] = []
  let outBubbleArticles: GroupedArticle[] = []
  let fallbackArticles: GroupedArticle[] = []   // for category/date filter mode
  let bubbleMode: 'vector' | 'category' | 'none' = 'none'
  let userTopCats: string[] = []
  let error: Error | null = null
  let filterStrength = 0.5

  const groupingThreshold = 0.92

  try {
    const supabase = await createClient()

    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError) { user = null } else { user = userData.user }

    if (user) {
      if (!params || typeof params.strength !== 'string') {
        const { data: profile } = await supabase
          .from('user_profile').select('filter_strength')
          .eq('user_id', user.email).single()
        filterStrength = Math.max(0, Math.min(1, profile?.filter_strength ?? 0.5))
      } else {
        filterStrength = Math.max(0, Math.min(1, parseFloat(params.strength) || 0.5))
      }
    }

    if (!user) redirect('/login')

    const userEmail = user!.email || ''

    // Interactions (for seen/dismissed dedup)
    const { data: interactions } = await supabase
      .from('user_interactions').select('article_id, interaction_type').eq('user_id', userEmail)
    const seenIds = new Set<string>()
    const dismissedIds = new Set<string>()
    for (const i of (interactions || [])) {
      if (i.interaction_type === 'not_interested') dismissedIds.add(i.article_id)
      seenIds.add(i.article_id)
    }

    // User vector
    let userVector: number[] | null = null
    let hasM3Vector = false
    if (!selectedCategory) {
      const { data: vd } = await supabase
        .from('user_vectors').select('vector_m3, vector').eq('user_id', userEmail).single()
      userVector = parseVector(vd?.vector_m3) || parseVector(vd?.vector)
      hasM3Vector = !!parseVector(vd?.vector_m3)
    }

    // Category reading history — always fetch for bubble classification
    const { data: catHistory } = await supabase
      .from('user_interactions')
      .select('articles(category)')
      .eq('user_id', userEmail)
      .in('interaction_type', ['view', 'deep_dive'])
      .limit(200)

    const catFreq: Record<string, number> = {}
    for (const row of (catHistory || [])) {
      const art = Array.isArray(row.articles) ? row.articles[0] : row.articles
      const cats = ((art as { category?: string } | null)?.category || '').split(',')
      for (const c of cats) {
        const t = c.trim()
        if (t && t !== 'その他') catFreq[t] = (catFreq[t] || 0) + 1
      }
    }
    userTopCats = Object.entries(catFreq).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c)

    // ======= FETCH STRATEGY =======
    if (selectedCategory || hasDateFilter) {
      // --- Category/date filter mode: simple list, no bubble split ---
      let query = supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
        .order('collected_at', { ascending: false })

      if (selectedCategory) query = query.like('category', `%${selectedCategory}%`)
      if (dateFrom) query = query.gte('collected_at', `${dateFrom}T00:00:00+09:00`)
      if (dateTo) query = query.lte('collected_at', `${dateTo}T23:59:59+09:00`)
      query = query.limit(60)

      const { data: raw } = await query
      const filtered = (raw || []).filter((a: Article) => !dismissedIds.has(a.id))
      const withEmb = filtered.map(a => ({ ...a, embedding: (a as unknown as Record<string, unknown>).embedding_m3 as number[] | string | undefined }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fallbackArticles = stripEmbeddings(groupSimilarArticles(withEmb as Article[], groupingThreshold) as any)
      bubbleMode = 'none'

    } else if (userVector && hasM3Vector) {
      // --- M3 vector mode: similarity-based bubble classification ---
      bubbleMode = 'vector'
      const outCount = Math.round(ZONE_SIZE * filterStrength)

      const { data: matched } = await supabase.rpc('match_articles_m3', {
        query_vector: userVector,
        match_count: 200,
      })

      const allMatched = (matched || []).filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))

      type MatchedArticle = Article & { similarity: number }
      const inRaw: MatchedArticle[] = allMatched
        .filter((a: MatchedArticle) => (a.similarity ?? 0) >= BUBBLE_THRESHOLD)
        .slice(0, ZONE_SIZE)
        .map((a: MatchedArticle) => ({ ...a, inBubble: true, bubbleScore: a.similarity }))

      const inIds = new Set(inRaw.map((a: Article) => a.id))
      const outRaw: MatchedArticle[] = allMatched
        .filter((a: MatchedArticle) => (a.similarity ?? 0) < BUBBLE_THRESHOLD && !inIds.has(a.id))
        .slice(0, outCount)
        .map((a: MatchedArticle) => ({ ...a, inBubble: false, bubbleScore: a.similarity }))

      const group = (articles: Article[]) => {
        const withEmb = articles.map(a => ({ ...a, embedding: (a as unknown as Record<string, unknown>).embedding_m3 as number[] | string | undefined }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return stripEmbeddings(groupSimilarArticles(withEmb as Article[], groupingThreshold) as any)
      }
      inBubbleArticles = group(inRaw as unknown as Article[])
      outBubbleArticles = group(outRaw as unknown as Article[])

    } else if (userTopCats.length >= 2) {
      // --- Category-based bubble classification (no M3 vector) ---
      bubbleMode = 'category'
      const outCount = Math.round(ZONE_SIZE * filterStrength)

      // In-bubble: recent articles from user's top categories
      const inCatFilter = userTopCats.map(c => `category.like.%${c}%`).join(',')
      const { data: inRaw } = await supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
        .or(inCatFilter)
        .order('collected_at', { ascending: false })
        .limit(60)

      const inFiltered = (inRaw || [])
        .filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))
        .slice(0, ZONE_SIZE)
        .map(a => ({ ...a, inBubble: true, bubbleScore: 0.8 }))

      // Out-of-bubble: recent articles NOT from user's top categories
      let outBubbleRaw: GroupedArticle[] = []
      if (outCount > 0) {
        const { data: recentRaw } = await supabase
          .from('articles')
          .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
          .order('collected_at', { ascending: false })
          .limit(200)

        const inIds = new Set(inFiltered.map(a => a.id))
        const outFiltered = (recentRaw || [])
          .filter((a: Article) => {
            if (seenIds.has(a.id) || dismissedIds.has(a.id) || inIds.has(a.id)) return false
            const cats = (a.category || '').split(',').map(c => c.trim())
            return !cats.some(c => userTopCats.includes(c))
          })
          .slice(0, outCount)
          .map(a => ({ ...a, inBubble: false, bubbleScore: 0.3 }))

        const withEmb = outFiltered.map(a => ({ ...a, embedding: (a as unknown as Record<string, unknown>).embedding_m3 as number[] | string | undefined }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        outBubbleRaw = stripEmbeddings(groupSimilarArticles(withEmb as Article[], groupingThreshold) as any)
      }

      const withEmb = inFiltered.map(a => ({ ...a, embedding: (a as unknown as Record<string, unknown>).embedding_m3 as number[] | string | undefined }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inBubbleArticles = stripEmbeddings(groupSimilarArticles(withEmb as Article[], groupingThreshold) as any)
      outBubbleArticles = outBubbleRaw

    } else {
      // --- No data: show latest articles as fallback ---
      bubbleMode = 'none'
      const { data: raw } = await supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
        .order('collected_at', { ascending: false })
        .limit(100)

      const filtered = (raw || []).filter((a: Article) => !dismissedIds.has(a.id)).slice(0, 20)
      const withEmb = filtered.map(a => ({ ...a, embedding: (a as unknown as Record<string, unknown>).embedding_m3 as number[] | string | undefined }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fallbackArticles = stripEmbeddings(groupSimilarArticles(withEmb as Article[], groupingThreshold) as any)
    }

  } catch (e: unknown) {
    console.error('Home page error:', e)
    if (typeof e === 'object' && e !== null && 'digest' in e &&
      (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')) throw e
    error = e instanceof Error ? e : new Error(String(e))
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white p-8 flex flex-col items-center justify-center text-center">
        <h1 className="text-3xl font-bold text-red-500 mb-4">System Error</h1>
        <div className="bg-slate-900 p-4 rounded font-mono text-xs overflow-auto max-w-2xl w-full border border-slate-800">
          {error.message}
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
            Your Feed
          </h1>
          <p className="text-slate-400">フィルタバブルを意識しながらニュースを読もう</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Suspense fallback={null}><FilterSlider initialValue={filterStrength} /></Suspense>
        </div>
      </header>

      <BubbleFeedLayout
        inBubbleArticles={inBubbleArticles}
        outBubbleArticles={outBubbleArticles}
        fallbackArticles={fallbackArticles}
        bubbleMode={bubbleMode}
        userTopCats={userTopCats}
        filterStrength={filterStrength}
        selectedCategory={selectedCategory}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />
    </div>
  )
}
