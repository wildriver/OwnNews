'use client'

// 操作記録の一元入口。
// (1) IndexedDBに履歴保存（高速・オフライン用キャッシュ）
// (2) 関心ベクトルを学習（deep_dive/興味なしは即時、閲覧は「閲覧時間」で重み付け）
// (3) 運営Supabaseへバックグラウンド同期（ログイン時。端末間で共有）
// (4) フィード再計算イベント発火

import { putInteraction, getAllInteractions, deleteInteractions, getKV, setKV, getAllArticles } from './store'
import { updateVector, updateVectorWeighted, engagementAlpha } from './engine'
import { pushInteraction, pushVector, deleteRemoteInteraction } from './sync'
import { InteractionType, LocalInteraction } from './types'

export const INTERACTION_EVENT = 'ownnews:interaction'

async function applyVector(embB64: string, next: number[] | null) {
    if (!next) return
    const now = new Date().toISOString()
    await setKV('user_vector', next)
    await setKV('vector_updated_at', now)
    pushVector(next, now)
    void embB64
}

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

        // ベクトル学習: deep_dive（深掘り=強い興味）と not_interested（減算）のみ即時反映。
        // view（クリックして開いただけ）はここでは反映せず、閲覧時間 recordDwell に委ねる。
        if (article?.emb && type !== 'view') {
            const current = (await getKV<number[]>('user_vector')) || null
            const next = updateVector(current, article.emb, type)
            await applyVector(article.emb, next)
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

/** ストック済みか（ローカルキャッシュ基準。同期後は端末間でも一致する） */
export async function isBookmarked(articleId: string): Promise<boolean> {
    const all = await getAllInteractions()
    return all.some(i => i.article_id === articleId && i.type === 'bookmark')
}

/**
 * ストックのON/OFF。
 * ON: 通常のinteractionとして記録（ベクトル学習・同期も通常経路）
 * OFF: ローカルとサーバーの両方から行を削除（学習の巻き戻しはしない）
 */
export async function toggleBookmark(articleId: string, on: boolean): Promise<void> {
    if (on) {
        await recordInteraction(articleId, 'bookmark')
    } else {
        await deleteInteractions([[articleId, 'bookmark']])
        deleteRemoteInteraction(articleId, 'bookmark')
    }
}

/**
 * 記事の閲覧時間(dwell)を記録する。記事詳細を離れたときに呼ぶ。
 * - 履歴のview行に dwell_seconds / scroll_depth をマージ保存
 * - 閲覧時間とスクロール到達度からエンゲージメント学習率を求め、関心ベクトルを重み付け更新
 *   （すぐ閉じた記事は α=0 で反映されない）
 */
export async function recordDwell(articleId: string, dwellSec: number, scrollDepth: number): Promise<void> {
    try {
        // 既存のview行に dwell を統合（最大値を採用: 再訪でリセットされないよう）
        const all = await getAllInteractions()
        const prev = all.find(i => i.article_id === articleId && (i.type === 'view' || i.type === 'deep_dive'))
        const mergedDwell = Math.max(prev?.dwell_seconds || 0, dwellSec)
        const mergedScroll = Math.max(prev?.scroll_depth || 0, scrollDepth)

        const articles = await getAllArticles()
        const article = articles.find(a => a.id === articleId)

        const row: LocalInteraction = {
            article_id: articleId,
            type: prev?.type || 'view',
            created_at: prev?.created_at || new Date().toISOString(),
            title: prev?.title || article?.title,
            link: prev?.link || article?.link,
            category: prev?.category || article?.category,
            category_medium: prev?.category_medium || article?.category_medium,
            category_minor: prev?.category_minor || article?.category_minor,
            fact_score: prev?.fact_score ?? article?.fact_score,
            context_score: prev?.context_score ?? article?.context_score,
            perspective_score: prev?.perspective_score ?? article?.perspective_score,
            emotion_score: prev?.emotion_score ?? article?.emotion_score,
            immediacy_score: prev?.immediacy_score ?? article?.immediacy_score,
            dwell_seconds: mergedDwell,
            scroll_depth: Math.round(mergedScroll * 100) / 100,
            synced: false,
        }
        await putInteraction(row)
        pushInteraction(row)

        // エンゲージメント重みでベクトル更新（今回のdwellぶんだけ。累積の二重加算を避ける）
        if (article?.emb) {
            const alpha = engagementAlpha(dwellSec, scrollDepth)
            if (alpha > 0) {
                const current = (await getKV<number[]>('user_vector')) || null
                const next = updateVectorWeighted(current, article.emb, alpha)
                await applyVector(article.emb, next)
                window.dispatchEvent(new CustomEvent(INTERACTION_EVENT, { detail: { articleId, type: 'dwell' } }))
            }
        }
    } catch (e) {
        console.error('recordDwell failed:', e)
    }
}
