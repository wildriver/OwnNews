export interface Article {
    id: string
    title: string
    link: string
    summary: string
    published: string
    category: string
    category_medium?: string
    category_minor?: string[]
    image_url?: string
    source?: string
    embedding?: number[] | string

    // News Nutrients (0-100)
    fact_score?: number
    context_score?: number
    perspective_score?: number
    emotion_score?: number
    immediacy_score?: number
}

export interface GroupedArticle extends Article {
    related: Article[]
}

export interface HealthStats {
    category_distribution: Record<string, number>
    medium_distribution: Record<string, number>
    top_keywords: { keyword: string; count: number }[]
    diversity_score: number
    dominant_category: string
    dominant_ratio: number
    bias_level: string
    missing_categories: string[]
    total_viewed: number
    nutrient_averages: {
        fact: number
        context: number
        perspective: number
        emotion: number
        immediacy: number
    }
}

// RSS categories from ceek.jp — must match RSS_CATEGORIES in category-filter-bar.tsx
export const ONBOARDING_CATEGORIES = [
    'IT', 'スポーツ', 'エンターテイメント', '地方・地域',
    '訃報・人事', 'サイエンス', '中国・韓国', 'その他',
]
