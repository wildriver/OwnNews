import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewsGrid } from '@/components/news-grid'
import { FilterSlider } from '@/components/filter-slider'
import { GroupingSlider } from '@/components/grouping-slider'
import { groupSimilarArticles } from '@/lib/news'
import { Article, GroupedArticle } from '@/lib/types'
import { Suspense } from 'react'

export const runtime = 'edge'

// Parse vector from Supabase (can be string or array)
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
  let user = null
  let articles: GroupedArticle[] = []
  let error: Error | null = null
  let filterStrength = 0.5
  let groupingThreshold = 0.92

  try {
    const supabase = await createClient()
    const params = await searchParams

    // Get user session safely
    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.log('Auth check failed:', authError.message)
      user = null
    } else {
      user = userData.user
    }

    if (user) {
      // Fetch saved preferences if no params
      let savedStrength: number | null = null
      let savedGrouping: number | null = null

      const needsProfileFetch = !params || (typeof params.strength !== 'string' || typeof params.grouping !== 'string')

      if (needsProfileFetch) {
        const { data: profile } = await supabase
          .from('user_profile')
          .select('*')
          .eq('user_id', user.email)
          .single()
        savedStrength = profile?.filter_strength ?? null
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        savedGrouping = (profile as any)?.grouping_threshold ?? null
      }

      // Determine final strength: URL > Saved > Default
      const rawStrength = typeof params?.strength === 'string'
        ? parseFloat(params.strength)
        : (savedStrength ?? 0.5)
      filterStrength = Math.max(0, Math.min(1, rawStrength || 0.5))

      // Determine final grouping threshold: URL > Saved > Default (0.92)
      const rawGrouping = typeof params?.grouping === 'string'
        ? parseFloat(params.grouping)
        : (savedGrouping ?? 0.92)
      groupingThreshold = Math.max(0.70, Math.min(0.99, rawGrouping || 0.92))
    }

    if (!user) {
      redirect('/login')
    }

    const userEmail = user.email || ''

    // 1. Get ALL user interactions (view, not_interested)
    const { data: interactions } = await supabase
      .from('user_interactions')
      .select('article_id, interaction_type')
      .eq('user_id', userEmail)

    const seenIds = new Set<string>()
    const dismissedIds = new Set<string>()

    for (const i of (interactions || [])) {
      if (i.interaction_type === 'not_interested') {
        dismissedIds.add(i.article_id)
      }
      seenIds.add(i.article_id)
    }

    // 2. Learn disliked categories from dismissed articles
    let dislikedCategories: Record<string, number> = {}
    if (dismissedIds.size > 0) {
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
            if (trimmed) {
              catCounts[trimmed] = (catCounts[trimmed] || 0) + 1
            }
          }
        }
      }
      dislikedCategories = catCounts
    }

    // 3. Try to get user vector for personalization
    const { data: vectorData } = await supabase
      .from('user_vectors')
      .select('vector_m3, vector')
      .eq('user_id', userEmail)
      .single()

    const userVector = parseVector(vectorData?.vector_m3) || parseVector(vectorData?.vector)
    const hasM3Vector = !!parseVector(vectorData?.vector_m3)

    // 4. Calculate blend counts
    const totalTarget = 80
    const personalizedCount = userVector && hasM3Vector
      ? Math.max(0, Math.round(totalTarget * filterStrength))
      : 0
    const latestCount = totalTarget - personalizedCount

    // 5. Downrank function: penalize articles in disliked categories
    const calcPenalty = (article: Article): number => {
      let penalty = 0
      const artMedium = (article as unknown as Record<string, unknown>).category_medium as string | undefined
      if (artMedium && dislikedCategories[artMedium]) {
        penalty += dislikedCategories[artMedium] * 0.3
      }
      if (article.category) {
        for (const c of article.category.split(',')) {
          const trimmed = c.trim()
          if (trimmed && dislikedCategories[trimmed]) {
            penalty += dislikedCategories[trimmed] * 0.2
          }
        }
      }
      return Math.min(penalty, 1.0) // cap at 1.0
    }

    // 6. Fetch personalized articles (if user vector exists and is M3)
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

    // 7. Fetch latest articles (neutral)
    let latestArticles: Article[] = []
    if (latestCount > 0) {
      const { data: articlesRaw } = await supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, embedding_m3, fact_score, context_score, perspective_score, emotion_score, immediacy_score')
        .order('collected_at', { ascending: false })
        .limit(latestCount + 60)

      latestArticles = (articlesRaw || [])
        .filter((a: Article) => !seenIds.has(a.id) && !dismissedIds.has(a.id))
    }

    // 8. Apply dislike penalties and sort latest by relevance
    if (Object.keys(dislikedCategories).length > 0) {
      latestArticles.sort((a, b) => calcPenalty(a) - calcPenalty(b))
    }

    // 9. Merge & deduplicate
    const personalizedIds = new Set(personalizedArticles.map(a => a.id))
    const uniqueLatest = latestArticles.filter(a => !personalizedIds.has(a.id))

    // Interleave: personalized first, then latest
    const merged = [...personalizedArticles, ...uniqueLatest].slice(0, totalTarget)

    // 10. Map embedding_m3 -> embedding for grouping, then group
    const articlesWithEmb = merged.map(a => ({
      ...a,
      embedding: (a as unknown as Record<string, unknown>).embedding_m3 as (number[] | string | undefined),
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    articles = groupSimilarArticles(articlesWithEmb as Article[], groupingThreshold) as any
    articles = articles.slice(0, 50)

  } catch (e: unknown) {
    console.error('Home page error:', e)
    if (
      typeof e === 'object' &&
      e !== null &&
      'digest' in e &&
      (e as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw e
    }
    if (e instanceof Error) {
      error = e
    } else {
      error = new Error(String(e))
    }
  }

  // Fallback UI
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

  if (!user) {
    return null
  }

  // Normal Render
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

      <NewsGrid articles={articles || []} />
    </div>
  )
}
