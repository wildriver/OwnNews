'use client'

// ログイン後、どのページでも一度だけ運営Supabaseから本人データを取り込む。
// 完了すると SYNCED_EVENT が発火し、フィード/履歴/ダッシュボードが最新化される。
// あわせてPWAのService Workerを登録する（プッシュ通知・ホーム追加のため）。

import { useEffect } from 'react'
import { pullUserData } from '@/lib/client/sync'

export function CloudSync() {
    useEffect(() => {
        pullUserData()
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => { /* 未対応環境は無視 */ })
        }
    }, [])
    return null
}
