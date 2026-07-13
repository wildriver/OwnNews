'use client'

// デプロイ検証用のバージョン表示（右下）。
// どのビルドが本番に出ているかをコミットハッシュ+ビルド時刻で示す運用補助。
// 研究参加者には意味が無いので、運営（管理者）にだけ表示する。

import { useEffect, useState } from 'react'
import { checkIsAdmin } from '@/lib/client/admin'

export function VersionBadge() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    checkIsAdmin().then(ok => { if (!cancelled) setIsAdmin(ok) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!isAdmin) return null

  const hash = process.env.NEXT_PUBLIC_GIT_HASH || 'dev'
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME || null

  const label = buildTime
    ? `v${hash.slice(0, 7)} · ${new Date(buildTime).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : `v${hash.slice(0, 7)}`

  return (
    <div className="fixed bottom-2 right-3 z-50 pointer-events-none hidden md:block">
      <span className="text-[10px] text-muted-foreground/50 font-mono select-none">
        {label}
      </span>
    </div>
  )
}
