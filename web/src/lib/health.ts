import { SupabaseClient } from '@supabase/supabase-js'
import { HealthStats, ONBOARDING_CATEGORIES } from './types'

// Define types for Supabase responses to avoid 'any'
interface ArticleJoin {
    category: string | null
    category_medium: string | null
    category_minor: string[] | null
}

interface InteractionWithArticle {
    article_id: string
    articles: ArticleJoin | ArticleJoin[] | null // Supabase join can return array or single object depending on relationship
}

export async function getInformationHealth(
    supabase: SupabaseClient,
    userId: string,
    period: '7d' | '30d' | '90d' = '30d'
): Promise<HealthStats> {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days)

    const { data } = await supabase
        .from('user_interactions')
        .select(`
            article_id,
            created_at,
            articles (
                category,
                category_medium,
                category_minor
            )
        `)
        .eq('user_id', userId)
        .in('interaction_type', ['view', 'deep_dive'])
        .gte('created_at', sinceDate.toISOString())

    // Cast data safely
    const interactions = data as unknown as InteractionWithArticle[] | null

    if (!interactions || interactions.length === 0) {
        return createEmptyStats()
    }

    const allCats: string[] = []
    const allMediums: string[] = []
    const allKeywords: string[] = []

    interactions.forEach((interaction) => {
        // Handle potential array or single object from join
        const articleData = Array.isArray(interaction.articles)
            ? interaction.articles[0]
            : interaction.articles

        if (articleData) {
            // Top-level category
            if (articleData.category) {
                articleData.category.split(',').forEach((c: string) => {
                    const trimmed = c.trim()
                    if (trimmed) allCats.push(trimmed)
                })
            }
            // Medium category
            if (articleData.category_medium && articleData.category_medium !== 'その他') {
                allMediums.push(articleData.category_medium)
            }
            // Minor keywords
            if (articleData.category_minor && Array.isArray(articleData.category_minor)) {
                articleData.category_minor.forEach((kw: string) => {
                    if (kw && kw.trim()) allKeywords.push(kw.trim())
                })
            }
        }
    })

    if (allCats.length === 0) {
        return createEmptyStats()
    }

    // 3. Calculate Stats — Major category
    const distribution: Record<string, number> = {}
    allCats.forEach((c) => {
        distribution[c] = (distribution[c] || 0) + 1
    })

    // Medium category distribution
    const mediumDistribution: Record<string, number> = {}
    allMediums.forEach((m) => {
        mediumDistribution[m] = (mediumDistribution[m] || 0) + 1
    })

    // Keyword frequency
    const keywordMap: Record<string, number> = {}
    allKeywords.forEach((kw) => {
        keywordMap[kw] = (keywordMap[kw] || 0) + 1
    })
    const topKeywords = Object.entries(keywordMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword, count]) => ({ keyword, count }))

    const total = allCats.length
    const nCategories = Object.keys(distribution).length
    let diversityScore = 0

    if (nCategories > 1) {
        let entropy = 0
        Object.values(distribution).forEach((count) => {
            const p = count / total
            entropy -= p * Math.log2(p)
        })
        const maxEntropy = Math.log2(nCategories)
        diversityScore = Math.round((entropy / maxEntropy) * 100)
    }

    // Find dominant
    let dominantCategory = ''
    let maxCount = 0
    Object.entries(distribution).forEach(([cat, count]) => {
        if (count > maxCount) {
            maxCount = count
            dominantCategory = cat
        }
    })

    const dominantRatio = total > 0 ? parseFloat((maxCount / total).toFixed(2)) : 0

    let biasLevel = 'バランス良好'
    if (dominantRatio > 0.6) biasLevel = '偏食（強）'
    else if (dominantRatio > 0.4) biasLevel = 'やや偏り'

    const seenCats = new Set(Object.keys(distribution))
    const missingCategories = ONBOARDING_CATEGORIES.filter(c => !seenCats.has(c))

    return {
        category_distribution: distribution,
        medium_distribution: mediumDistribution,
        top_keywords: topKeywords,
        diversity_score: diversityScore,
        dominant_category: dominantCategory,
        dominant_ratio: dominantRatio,
        bias_level: biasLevel,
        missing_categories: missingCategories,
        total_viewed: total
    }
}

function createEmptyStats(): HealthStats {
    return {
        category_distribution: {},
        medium_distribution: {},
        top_keywords: [],
        diversity_score: 0,
        dominant_category: '',
        dominant_ratio: 0.0,
        bias_level: 'データ不足',
        missing_categories: ONBOARDING_CATEGORIES,
        total_viewed: 0,
    }
}

export async function getActivityHistory(
    supabase: SupabaseClient,
    userId: string
) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    const data: { name: string; date: string; count: number }[] = [];

    // Initialize last 7 days with 0
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dayName = days[d.getDay()];
        const dateStr = d.toISOString().split('T')[0];
        data.push({ name: dayName, date: dateStr, count: 0 });
    }

    // Get interactions for last 7 days
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const { data: interactions } = await supabase
        .from('user_interactions')
        .select('created_at')
        .eq('user_id', userId)
        .gte('created_at', sevenDaysAgo.toISOString());

    if (interactions) {
        interactions.forEach((i: { created_at: string }) => {
            const dateStr = i.created_at.split('T')[0];
            const dayData = data.find(d => d.date === dateStr);
            if (dayData) {
                dayData.count++;
            }
        });
    }

    return data;
}

export async function getInformationHealthSeries(
    supabase: SupabaseClient,
    userId: string,
    period: '7d' | '30d' | '90d' = '30d'
) {
    const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const sinceDate = new Date()
    sinceDate.setDate(sinceDate.getDate() - days)

    const { data: interactionsRaw } = await supabase
        .from('user_interactions')
        .select(`
            created_at,
            articles (
                category
            )
        `)
        .eq('user_id', userId)
        .in('interaction_type', ['view', 'deep_dive'])
        .gte('created_at', sinceDate.toISOString())
        .order('created_at', { ascending: true })

    if (!interactionsRaw) return []

    // Group by day for 7d/30d, or by week for 90d
    const result: Record<string, Record<string, number>> = {}
    const timeFormat = period === '90d' ? 'week' : 'day'
        ; (interactionsRaw as unknown as { created_at: string; articles: ArticleJoin | ArticleJoin[] | null }[]).forEach((i) => {
            const date = new Date(i.created_at)
            let key = ''
            if (timeFormat === 'day') {
                key = date.toISOString().split('T')[0]
            } else {
                // Week key: YYYY-WW
                const firstDayOfYear = new Date(date.getFullYear(), 0, 1)
                const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000
                const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7)
                key = `${date.getFullYear()}-W${weekNum}`
            }

            if (!result[key]) result[key] = {}
            const articleData = Array.isArray(i.articles) ? i.articles[0] : i.articles
            if (articleData?.category) {
                articleData.category.split(',').forEach((c: string) => {
                    const trimmed = c.trim()
                    if (trimmed) {
                        result[key][trimmed] = (result[key][trimmed] || 0) + 1
                    }
                })
            }
        })

    return Object.entries(result).map(([date, counts]) => ({
        date,
        counts
    }))
}
