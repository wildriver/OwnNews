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

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams

  // Category filter from URL param (?category=IT など)
  const selectedCategory = typeof params?.category === 'string' ? params.category.trim() : null

  let user = null
  let articles: GroupedArticle[] = []
  let error: Error | null = null
  let filterStrength = 0.5
  let groupingThreshold = 0.92

  try {
    const supabase = await createClient()

    // Auth
    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.log('Auth check failed:', authError.message)
      user = null
    } else {
      user = userData.user
    }

    if (user) {
      const needsProfileFetch = !params || (typeof params.strength !== 'string' || typeof params.grouping !== 'string')

      if (needsProfileFetch) {
        const { data: profile } = await supabase
          .from('user_profile')
          .select('*')
          .eq('user_id', user.email)
          .single()
        const savedStrength = profile?.filter_strength ?? null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const savedGrouping = (profile as any)?.grouping_threshold ?? null

        const rawStrength = typeof params?.strength === 'string'
          ? parseFloat(params.strength)
          : (savedStrength ?? 0.5)
        filterStrength = Math.max(0, Math.min(1, rawStrength || 0.5))

        const rawGrouping = typeof params?.grouping === 'string'
          ? parseFloat(params.grouping)
          : (savedGrouping ?? 0.92)
        groupingThreshold = Math.max(0.70, Math.min(0.99, rawGrouping || 0.92))
      } else {
        filterStrength = Math.max(0, Math.min(1, parseFloat(params.strength as string) || 0.5))
        groupingThreshold = Math.max(0.70, Math.min(0.99, parseFloat(params.grouping as string) || 0.92))
      }
    }

    if (!user) {
      redirect('/login')
    }

    const userEmail = user.email || ''

    // 1. User interactions
    const { data: interactions } = await supabase
      .from('user_interactions')
      .select('article_id, interaction_type')
      .eq('user_id', userEmail)

    const seenIds = new Set<string>()
    const dismissedIds = new Set<string>()
    for (const i of (interactions || [])) {
      if (i.interaction_type === 'not_interested') dismissedIds.add(i.article_id)
      seenIds.add(i.article_id)
    }

    // 2. Disliked categories (skip when category filter active)
    let dislikedCategories: Record<string, number> = {}
    if (dismissedIds.size > 0 && !selectedCategory) {
      const { data: dismissedArticles } = await supabase
        .from('articles')
        .select('category, category_medium')
        .in('id', Array.from(dismissedIds))

      const catCounts: Record<string, number> = {}
      for (const a of (dismissedArticles || [])) {
        if (a.category_medium && a.category_medium !== 'その他') {
          catCounts[a.category_medium] = (catCounts[a.category_medium] || 0) + 1
        }
        if (a.category) {
          for (const c of a.category.split(',')) {
            const trimmed = c.trim()
            if (trimmed) catCounts[trimmed] = (catCounts[trimmed] || 0) + 1
          }
        }
      }
      dislikedCategories = catCounts
    }

    // 3. User vector (skip when category filter active)
    let userVector: number[] | null = null
    let hasM3Vector = false
    if (!selectedCategory) {
      const { data: vectorData } = await supabase
        .from('user_vectors')
        .select('vector_m3, vector')
        .eq('user_id', userEmail)
        .single()
      userVector = parseVector(vectorData?.vector_m3) || parseVector(vectorData?.vector)
      hasM3Vector = !!parseVector(vectorData?.vector_m3)
    }

    // 4. Blend counts
    const totalTarget = selectedCategory ? 200 : 80
    const personalizedCount = (!selectedCategory && userVector && hasM3Vector)
      ? Math.max(0, Math.round(totalTarget * filterStrength))
      : 0
    const latestCount = totalTarget - personalizedCount

    // 5. Downrank penalty
    const calcPenalty = (article: Article): number => {
      let penalty = 0
      const artMedium = (article as unknown as Record<string, unknown>).category_medium as string | undefined
      if (artMedium && dislikedCategories[artMedium]) penalty += dislikedCategories[artMedium] * 0.3
      if (article.category) {
        for (const c of article.category.split(',')) {
          const trimmed = c.trim()
          if (trimmed && dislikedCategories[trimmed]) penalty += dislikedCategories[trimmed] * 0.2
        }
      }
      return Math.min(penalty, 1.0)
    }

    // 6. Personalized articles
    let personalizedArticles: Article[] = []
    if (personalizedCount > 0 && userVector && hasM3Vector) {
      const { data: matched } = await supabase.rpc('match_articles_m3', {
        query_vector: userVector,
        match_count: personalizedCount + 30,
      })
      personalizedArticles = (matched || [])
        .filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))
        .slice(0, personalizedCount)
    }

    // 7. Latest articles — DB-filtered by RSS category when ?category= is set
    let latestArticles: Article[] = []
    if (latestCount > 0) {
      let query = supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
        .order('collected_at', { ascending: false })

      if (selectedCategory) {
        // Use RSS category field (comma-separated text like "IT" or "IT,その他")
        query = query.like('category', `%${selectedCategory}%`).limit(200)
      } else {
        query = query.limit(latestCount + 60)
      }

      const { data: articlesRaw } = await query
      latestArticles = (articlesRaw || [])
        .filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))
    }

    // 8. Apply penalties
    if (Object.keys(dislikedCategories).length > 0) {
      latestArticles.sort((a, b) => calcPenalty(a) - calcPenalty(b))
    }

    // 9. Merge
    const personalizedIds = new Set(personalizedArticles.map(a => a.id))
    const uniqueLatest = latestArticles.filter(a => !personalizedIds.has(a.id))
    const merged = selectedCategory
      ? uniqueLatest
      : [...personalizedArticles, ...uniqueLatest].slice(0, totalTarget)

    // 10. Group similar articles
    const articlesWithEmb = merged.map(a => ({
      ...a,
      embedding: (a as unknown as Record<string, unknown>).embedding_m3 as (number[] | string | undefined),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    articles = groupSimilarArticles(articlesWithEmb as Article[], groupingThreshold) as any
    if (!selectedCategory) articles = articles.slice(0, 50)

  } catch (e: unknown) {
    console.error('Home page error:', e)
    if (
      typeof e === 'object' && e !== null && 'digest' in e &&
      (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw e
    }
    error = e instanceof Error ? e : new Error(String(e))
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white p-8 flex flex-col items-center justify-center text-center">
        <h1 className="text-3xl font-bold text-red-500 mb-4">System Error</h1>
        <p className="text-slate-400 max-w-md mx-auto mb-8">
          The application encountered an error while initializing.
        </p>
        <div className="bg-slate-900 p-4 rounded text-left font-mono text-xs overflow-auto max-w-2xl w-full border border-slate-800">
          <p className="text-red-400 mb-2">Error Details:</p>
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
          <Suspense fallback={null}>
            <GroupingSlider initialValue={groupingThreshold} />
          </Suspense>
          <Suspense fallback={null}>
            <FilterSlider initialValue={filterStrength} />
          </Suspense>
        </div>
      </header>

      <NewsFeedClient articles={articles || []} selectedCategory={selectedCategory} />
    </div>
  )
}
