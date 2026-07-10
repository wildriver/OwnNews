'use client'

// 記事リアクション（1タップの主観表明）。
// 本人の行はRLS下で直接読み書きし、他人の分は匿名集計RPCで件数のみ取得する。
// 推薦には使わない（可視化専用。反対を減点すると意見バブルを助長するため）。

import { createClient } from '@/lib/supabase/client'
import { getUserEmail } from '@/lib/client/sync'

export type ReactionKey = 'agree' | 'disagree' | 'surprise' | 'insight' | 'doubt' | 'perspective'

export const REACTIONS: { key: ReactionKey; emoji: string; label: string; hint: string }[] = [
    { key: 'agree', emoji: '🙆', label: '賛成', hint: '同意できる・支持する' },
    { key: 'disagree', emoji: '🙅', label: '反対', hint: '異論がある・支持しない' },
    { key: 'surprise', emoji: '😮', label: '驚き', hint: '意外だった・予想外' },
    { key: 'insight', emoji: '💡', label: '学び', hint: '知らなかった・勉強になった' },
    { key: 'doubt', emoji: '🤔', label: '疑問', hint: '本当かな？裏付けが気になる' },
    { key: 'perspective', emoji: '🔭', label: '視点が広がった', hint: '普段と違う見方に出会えた' },
]

export interface ReactionState {
    counts: Record<string, number>
    mine: Set<ReactionKey>
}

/** 記事のリアクション状態（匿名集計＋自分が押したもの）を取得 */
export async function fetchReactions(articleId: string): Promise<ReactionState | null> {
    const email = await getUserEmail()
    if (!email) return null
    const supabase = createClient()
    const [countsRes, mineRes] = await Promise.all([
        supabase.rpc('article_reaction_counts', { p_article_id: articleId }),
        supabase.from('article_reactions').select('reaction').eq('user_id', email).eq('article_id', articleId),
    ])
    if (countsRes.error || mineRes.error) return null
    const counts: Record<string, number> = {}
    for (const row of (countsRes.data ?? []) as { reaction: string; cnt: number }[]) {
        counts[row.reaction] = Number(row.cnt)
    }
    const mine = new Set((mineRes.data ?? []).map(r => r.reaction as ReactionKey))
    return { counts, mine }
}

/** リアクションのON/OFF。成功したらtrue。 */
export async function toggleReaction(articleId: string, reaction: ReactionKey, on: boolean): Promise<boolean> {
    const email = await getUserEmail()
    if (!email) return false
    const supabase = createClient()
    if (on) {
        const { error } = await supabase.from('article_reactions').upsert(
            { user_id: email, article_id: articleId, reaction },
            { onConflict: 'user_id, article_id, reaction' }
        )
        return !error
    } else {
        const { error } = await supabase.from('article_reactions').delete()
            .eq('user_id', email).eq('article_id', articleId).eq('reaction', reaction)
        return !error
    }
}
