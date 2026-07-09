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
    /** 閲覧時間（秒）と最大スクロール到達度(0-1)。興味の強さ推定に使う */
    dwell_seconds?: number
    scroll_depth?: number
    /** 運営Supabaseへ同期済みか */
    synced?: boolean
}
