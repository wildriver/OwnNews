'use client'

// ログイン後、どのページでも一度だけ運営Supabaseから本人データを取り込む。
// 完了すると SYNCED_EVENT が発火し、フィード/履歴/ダッシュボードが最新化される。

import { useEffect } from 'react'
import { pullUserData } from '@/lib/client/sync'

export function CloudSync() {
    useEffect(() => {
        pullUserData()
    }, [])
    return null
}
