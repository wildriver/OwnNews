// ローカル推薦エンジンの型定義

export interface PackArticle {
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
    fact_score?: number
    context_score?: number
    perspective_score?: number
    emotion_score?: number
    immediacy_score?: number
    collected_at: string
    /** int8量子化された正規化済み1024次元埋め込み(base64) */
    emb: string | null
}

export type InteractionType = 'view' | 'deep_dive' | 'not_interested'

export interface LocalInteraction {
    article_id: string
    type: InteractionType
    created_at: string
    /** 記事メタデータのスナップショット（履歴・ダッシュボード用。記事がpruneされても参照可能） */
    title?: string
    link?: string
    category?: string
    category_medium?: string
    category_minor?: string[]
    fact_score?: number
    context_score?: number
    perspective_score?: number
    emotion_score?: number
    immediacy_score?: number
    /** 個人Supabaseへ同期済みか */
    synced?: boolean
}

export interface PersonalDBConfig {
    url: string
    key: string
}

export interface EngineState {
    /** 関心ベクトル（1024次元、L2正規化済み） */
    vector: number[] | null
    updatedAt: string
}
