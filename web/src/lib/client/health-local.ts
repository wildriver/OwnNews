'use client'

// 情報的健康スコアのローカル計算
// サーバ版 lib/health.ts と同じロジックを、IndexedDB内の閲覧履歴
// （記事メタデータのスナップショット付き）に対して適用する。

import { HealthStats, ONBOARDING_CATEGORIES } from '@/lib/types'
import { LocalInteraction, PackArticle } from './types'

export type Period = '7d' | '30d' | '90d'

function periodDays(period: Period): number {
    return period === '7d' ? 7 : period === '30d' ? 30 : 90
}

function withinPeriod(interactions: LocalInteraction[], period: Period): LocalInteraction[] {
    const since = new Date()
    since.setDate(since.getDate() - periodDays(period))
    const sinceISO = since.toISOString()
    return interactions.filter(i => i.created_at >= sinceISO)
}

export function computeHealthStats(all: LocalInteraction[], period: Period = '30d'): HealthStats {
    const interactions = withinPeriod(all, period).filter(i => i.type === 'view' || i.type === 'deep_dive')

    if (interactions.length === 0) return createEmptyStats()

    const allCats: string[] = []
    const allMediums: string[] = []
    const allKeywords: string[] = []

    let totalFact = 0, totalContext = 0, totalPerspective = 0, totalEmotion = 0, totalImmediacy = 0
    let nutrientCount = 0

    for (const i of interactions) {
        if (i.category) {
            for (const c of i.category.split(',')) {
                const t = c.trim()
                if (t) allCats.push(t)
            }
        }
        if (i.category_medium && i.category_medium !== 'その他') {
            allMediums.push(i.category_medium)
        }
        if (Array.isArray(i.category_minor)) {
            for (const kw of i.category_minor) {
                if (kw && kw.trim()) allKeywords.push(kw.trim())
            }
        }
        const hasScore = (i.fact_score || 0) > 0 || (i.context_score || 0) > 0 ||
            (i.perspective_score || 0) > 0 || (i.emotion_score || 0) > 0 || (i.immediacy_score || 0) > 0
        if (hasScore) {
            totalFact += i.fact_score || 0
            totalContext += i.context_score || 0
            totalPerspective += i.perspective_score || 0
            totalEmotion += i.emotion_score || 0
            totalImmediacy += i.immediacy_score || 0
            nutrientCount++
        }
    }

    if (allCats.length === 0) return createEmptyStats()

    const distribution: Record<string, number> = {}
    allCats.forEach(c => { distribution[c] = (distribution[c] || 0) + 1 })

    const mediumDistribution: Record<string, number> = {}
    allMediums.forEach(m => { mediumDistribution[m] = (mediumDistribution[m] || 0) + 1 })

    const keywordMap: Record<string, number> = {}
    allKeywords.forEach(kw => { keywordMap[kw] = (keywordMap[kw] || 0) + 1 })
    const topKeywords = Object.entries(keywordMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword, count]) => ({ keyword, count }))

    const catTotal = allCats.length
    const nCategories = Object.keys(distribution).length
    let diversityScore = 0
    if (nCategories > 1) {
        let entropy = 0
        Object.values(distribution).forEach(count => {
            const p = count / catTotal
            entropy -= p * Math.log2(p)
        })
        diversityScore = Math.round((entropy / Math.log2(nCategories)) * 100)
    }

    let dominantCategory = ''
    let maxCount = 0
    Object.entries(distribution).forEach(([cat, count]) => {
        if (count > maxCount) { maxCount = count; dominantCategory = cat }
    })
    const dominantRatio = catTotal > 0 ? parseFloat((maxCount / catTotal).toFixed(2)) : 0

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
        total_viewed: interactions.length,
        nutrient_averages: {
            fact: nutrientCount > 0 ? Math.round(totalFact / nutrientCount) : 0,
            context: nutrientCount > 0 ? Math.round(totalContext / nutrientCount) : 0,
            perspective: nutrientCount > 0 ? Math.round(totalPerspective / nutrientCount) : 0,
            emotion: nutrientCount > 0 ? Math.round(totalEmotion / nutrientCount) : 0,
            immediacy: nutrientCount > 0 ? Math.round(totalImmediacy / nutrientCount) : 0,
        },
    }
}

export function createEmptyStats(): HealthStats {
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
        nutrient_averages: { fact: 0, context: 0, perspective: 0, emotion: 0, immediacy: 0 },
    }
}

/** 直近7日の日別アクティビティ */
export function computeActivityHistory(all: LocalInteraction[]) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const today = new Date()
    const data: { name: string; date: string; count: number }[] = []

    for (let i = 6; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(today.getDate() - i)
        data.push({ name: days[d.getDay()], date: d.toISOString().split('T')[0], count: 0 })
    }

    for (const i of all) {
        const dateStr = i.created_at.split('T')[0]
        const dayData = data.find(d => d.date === dateStr)
        if (dayData) dayData.count++
    }
    return data
}

/** カテゴリ別接触数の時系列（7d/30d=日別、90d=週別） */
export function computeHealthSeries(all: LocalInteraction[], period: Period = '30d') {
    const interactions = withinPeriod(all, period).filter(i => i.type === 'view' || i.type === 'deep_dive')
    const result: Record<string, Record<string, number>> = {}
    const timeFormat = period === '90d' ? 'week' : 'day'

    for (const i of interactions) {
        const date = new Date(i.created_at)
        let key = ''
        if (timeFormat === 'day') {
            key = date.toISOString().split('T')[0]
        } else {
            const firstDayOfYear = new Date(date.getFullYear(), 0, 1)
            const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000
            const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7)
            key = `${date.getFullYear()}-W${weekNum}`
        }
        if (!result[key]) result[key] = {}
        for (const c of (i.category || '').split(',')) {
            const t = c.trim()
            if (t) result[key][t] = (result[key][t] || 0) + 1
        }
    }

    return Object.entries(result)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, counts]) => ({ date, counts }))
}

/** 記事パック全体のカテゴリ分布（ジャンル母集団の可視化用） */
export function computeGlobalCategoryDistribution(articles: PackArticle[]): { category: string; count: number }[] {
    const dist: Record<string, number> = {}
    for (const a of articles) {
        if (!a.category) continue
        for (const cat of a.category.split(',')) {
            const t = cat.trim()
            if (t) dist[t] = (dist[t] || 0) + 1
        }
    }
    return Object.entries(dist)
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12)
}
