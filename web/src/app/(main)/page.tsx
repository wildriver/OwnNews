import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewsFeedClient } from '@/components/news-feed-client'
import { FilterSlider } from '@/components/filter-slider'
import { GroupingSlider } from '@/components/grouping-slider'
import { groupSimilarArticles } from '@/lib/news'
import { Article, GroupedArticle } from '@/lib/types'
import { Suspense } from 'react'

export const runtime = 'edge'

function parseVector(v: unknown): number[] | null {
  if (!v) return null
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return null }
  }
  if (Array.isArray(v)) return v as number[]
  return null
}

// Round-robin diversify: pick articles evenly across categories
function diversify(articles: Article[], targetCount: number): Article[] {
  const byCategory: Record<string, Article[]> = {}
  for (const a of articles) {
    const primaryCat = (a.category || '').split(',')[0]?.trim() || 'その他'
    if (!byCategory[primaryCat]) byCategory[primaryCat] = []
    byCategory[primaryCat].push(a)
  }
  const groups = Object.values(byCategory)
  const result: Article[] = []
  let i = 0
  while (result.length < targetCount) {
    let added = false
    for (const group of groups) {
      if (group[i]) {
        result.push(group[i])
        added = true
        if (result.length >= targetCount) break
      }
    }
    if (!added) break
    i++
  }
  return result
}

// Strip heavy embedding vectors before sending to client
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
  let articles: GroupedArticle[] = []
  let error: Error | null = null
  let filterStrength = 0.5
  let groupingThreshold = 0.92

  try {
    const supabase = await createClient()

    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError) { user = null } else { user = userData.user }

    if (user) {
      if (!params || typeof params.strength !== 'string' || typeof params.grouping !== 'string') {
        const { data: profile } = await supabase
          .from('user_profile').select('filter_strength, grouping_threshold')
          .eq('user_id', user.email).single()
        const savedStrength = profile?.filter_strength ?? 0.5
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const savedGrouping = (profile as any)?.grouping_threshold ?? 0.92
        filterStrength = Math.max(0, Math.min(1, savedStrength))
        groupingThreshold = Math.max(0.70, Math.min(0.99, savedGrouping))
      } else {
        filterStrength = Math.max(0, Math.min(1, parseFloat(params.strength) || 0.5))
        groupingThreshold = Math.max(0.70, Math.min(0.99, parseFloat(params.grouping) || 0.92))
      }
    }

    if (!user) redirect('/login')

    const userEmail = user!.email || ''

    // Interactions
    const { data: interactions } = await supabase
      .from('user_interactions').select('article_id, interaction_type').eq('user_id', userEmail)
    const seenIds = new Set<string>()
    const dismissedIds = new Set<string>()
    for (const i of (interactions || [])) {
      if (i.interaction_type === 'not_interested') dismissedIds.add(i.article_id)
      seenIds.add(i.article_id)
    }

    // Disliked categories (skip for category filter mode)
    let dislikedCategories: Record<string, number> = {}
    if (dismissedIds.size > 0 && !selectedCategory) {
      const { data: dismissed } = await supabase
        .from('articles').select('category, category_medium').in('id', Array.from(dismissedIds))
      const counts: Record<string, number> = {}
      for (const a of (dismissed || [])) {
        if (a.category_medium && a.category_medium !== 'その他') {
          counts[a.category_medium] = (counts[a.category_medium] || 0) + 1
        }
        for (const c of (a.category || '').split(',')) {
          const t = c.trim()
          if (t) counts[t] = (counts[t] || 0) + 1
        }
      }
      dislikedCategories = counts
    }

    // User vector (skip for category filter mode)
    let userVector: number[] | null = null
    let hasM3Vector = false
    if (!selectedCategory) {
      const { data: vd } = await supabase
        .from('user_vectors').select('vector_m3, vector').eq('user_id', userEmail).single()
      userVector = parseVector(vd?.vector_m3) || parseVector(vd?.vector)
      hasM3Vector = !!parseVector(vd?.vector_m3)
    }

    // Fetch 200 latest articles and diversify to 20 for initial display
    // (avoids "all その他" problem caused by insertion order within same collected_at batch)
    const INITIAL = 20
    const FETCH_BUFFER = 200
    // Disable personalization when date filter or category filter is active
    const personalizedCount = (!selectedCategory && !hasDateFilter && userVector && hasM3Vector)
      ? Math.max(0, Math.round(INITIAL * filterStrength))
      : 0
    const latestCount = INITIAL - personalizedCount

    const calcPenalty = (a: Article) => {
      let p = 0
      const m = (a as unknown as Record<string, unknown>).category_medium as string | undefined
      if (m && dislikedCategories[m]) p += dislikedCategories[m] * 0.3
      for (const c of (a.category || '').split(',')) {
        const t = c.trim()
        if (t && dislikedCategories[t]) p += dislikedCategories[t] * 0.2
      }
      return Math.min(p, 1.0)
    }

    // Personalized
    let personalizedArticles: Article[] = []
    if (personalizedCount > 0 && userVector && hasM3Vector) {
      const { data: matched } = await supabase.rpc('match_articles_m3', {
        query_vector: userVector,
        match_count: personalizedCount + 20,
      })
      personalizedArticles = (matched || [])
        .filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))
        .slice(0, personalizedCount)
    }

    // Latest (+ category filter + date filter)
    let latestArticles: Article[] = []
    if (latestCount > 0) {
      let query = supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
        .order('published', { ascending: false })

      if (selectedCategory) {
        query = query.like('category', `%${selectedCategory}%`)
      }
      if (dateFrom) {
        query = query.gte('published', `${dateFrom}T00:00:00`)
      }
      if (dateTo) {
        query = query.lte('published', `${dateTo}T23:59:59`)
      }
      if (selectedCategory || hasDateFilter) {
        query = query.limit(INITIAL + 20)
      } else {
        // Fetch large buffer to enable category diversification
        query = query.limit(FETCH_BUFFER)
      }

      const { data: raw } = await query
      latestArticles = (raw || []).filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))
    }

    if (Object.keys(dislikedCategories).length > 0) {
      latestArticles.sort((a, b) => calcPenalty(a) - calcPenalty(b))
    }

    const personalizedIds = new Set(personalizedArticles.map(a => a.id))
    const uniqueLatest = latestArticles.filter(a => !personalizedIds.has(a.id))

    let merged: Article[]
    if (selectedCategory || hasDateFilter) {
      merged = uniqueLatest.slice(0, INITIAL)
    } else {
      // Diversify latest articles across categories before merging with personalized
      const diverseLatest = diversify(uniqueLatest, latestCount)
      merged = [...personalizedArticles, ...diverseLatest].slice(0, INITIAL)
    }

    // Group similar articles
    const withEmb = merged.map(a => ({
      ...a,
      embedding: (a as unknown as Record<string, unknown>).embedding_m3 as number[] | string | undefined,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const grouped = groupSimilarArticles(withEmb as Article[], groupingThreshold) as any

    // Strip embedding vectors — they're large and not needed on the client
    articles = stripEmbeddings(grouped)

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
          <p className="text-slate-400">AIによって厳選された最新ニュース</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Suspense fallback={null}><GroupingSlider initialValue={groupingThreshold} /></Suspense>
          <Suspense fallback={null}><FilterSlider initialValue={filterStrength} /></Suspense>
        </div>
      </header>

      <NewsFeedClient
        articles={articles || []}
        selectedCategory={selectedCategory}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />
    </div>
  )
}
