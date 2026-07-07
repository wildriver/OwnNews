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

    // Filter bubble classification
    inBubble?: boolean    // true = user's bubble, false = outside bubble
    bubbleScore?: number  // similarity (0-1) or category-based score
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

// カテゴリ一覧 — category-filter-bar.tsx の RSS_CATEGORIES と揃えること
export const ONBOARDING_CATEGORIES = [
    '政治', '経済', '国際', '社会',
    'IT', 'スポーツ', 'エンターテイメント', 'サイエンス',
    '地方・地域', '中国・韓国', '訃報・人事', 'その他',
]
