'use client'

// 操作記録の一元入口。
// (1) IndexedDBに履歴保存（高速・オフライン用キャッシュ）
// (2) 関心ベクトルをクリック履歴から更新（推薦エンジンの学習）
// (3) 運営Supabaseへバックグラウンド同期（ログイン時。端末間で共有）
// (4) フィード再計算イベント発火

import { putInteraction, getKV, setKV, getAllArticles } from './store'
import { updateVector } from './engine'
import { pushInteraction, pushVector } from './sync'
import { InteractionType, LocalInteraction } from './types'

export const INTERACTION_EVENT = 'ownnews:interaction'

export async function recordInteraction(articleId: string, type: InteractionType): Promise<void> {
    try {
        // 記事メタデータのスナップショットを添付（履歴・ダッシュボード集計用）
        const articles = await getAllArticles()
        const article = articles.find(a => a.id === articleId)

        const interaction: LocalInteraction = {
            article_id: articleId,
            type,
            created_at: new Date().toISOString(),
            title: article?.title,
            link: article?.link,
            category: article?.category,
            category_medium: article?.category_medium,
            category_minor: article?.category_minor,
            fact_score: article?.fact_score,
            context_score: article?.context_score,
            perspective_score: article?.perspective_score,
            emotion_score: article?.emotion_score,
            immediacy_score: article?.immediacy_score,
            synced: false,
        }
        await putInteraction(interaction)

        // 関心ベクトルをクリック履歴から更新（エンジンの学習）
        // 埋め込みがある記事のみ（未生成の間はスキップ、履歴自体は残る）
        if (article?.emb) {
            const current = (await getKV<number[]>('user_vector')) || null
            const next = updateVector(current, article.emb, type)
            if (next) {
                const now = new Date().toISOString()
                await setKV('user_vector', next)
                await setKV('vector_updated_at', now)
                pushVector(next, now)
            }
        }

        // 運営Supabaseへ操作を同期（ログイン時のみ実行される）
        pushInteraction(interaction)

        // フィードコンポーネントに通知（既読反映など）
        window.dispatchEvent(new CustomEvent(INTERACTION_EVENT, {
            detail: { articleId, type },
        }))
    } catch (e) {
        console.error('recordInteraction failed:', e)
    }
}
