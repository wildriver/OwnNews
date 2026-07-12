'use client'

// ウォッチタグ（タグ購読）。
// 記事のキーワードをタップして購読すると、そのタグを含む記事がトップの
// 専用枠に常時表示される（「確実に見たい」の保証）。もう一度タップで解除。
// 推薦ベクトルの学習には使わない（明示的な意思表示は自動学習と混ぜない）。

import { getKV, setKV } from './store'
import { pushSettings, getUserEmail } from './sync'
import { createClient } from '@/lib/supabase/client'

/** ウォッチタグ変更時に発火（フィードの専用枠・詳細ページのチップが再描画する） */
export const WATCHED_EVENT = 'ownnews:watched'

export async function getWatchedTags(): Promise<string[]> {
    return (await getKV<string[]>('watched_tags')) || []
}

export async function toggleWatchedTag(tag: string): Promise<{ tags: string[]; watched: boolean }> {
    const cur = await getWatchedTags()
    const has = cur.includes(tag)
    const tags = has ? cur.filter(t => t !== tag) : [...cur, tag]
    await setKV('watched_tags', tags)
    pushSettings({ watchedTags: tags })   // 端末間同期（last-write-wins）
    // 関心の変遷の歴史として購読/解除イベントを記録（fire-and-forget・本人のみRLS）
    getUserEmail().then(email => {
        if (!email) return
        createClient().from('watched_tag_events')
            .insert({ user_id: email, tag, action: has ? 'unwatch' : 'watch' })
            .then(({ error }) => { if (error) console.warn('watch event log failed:', error.message) })
    })
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(WATCHED_EVENT, { detail: { tags } }))
    }
    return { tags, watched: !has }
}
