'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, X } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'

function toJSTDate(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

function DateFilterInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const dateFrom = searchParams.get('dateFrom') || ''
  const dateTo = searchParams.get('dateTo') || ''

  // カスタム日付入力はローカルstateで保持し、blur/Enter時にのみURLへ反映する。
  // 即座にrouter.pushすると再レンダリングで入力が中断され、
  // 2桁の数値を素早く入力しないと反映されない問題があった。
  const [localFrom, setLocalFrom] = useState(dateFrom)
  const [localTo, setLocalTo] = useState(dateTo)

  // URLのsearchParamsが外部（プリセットボタン等）から変わった場合はローカルstateに同期する
  useEffect(() => {
    setLocalFrom(dateFrom)
  }, [dateFrom])
  useEffect(() => {
    setLocalTo(dateTo)
  }, [dateTo])

  const applyFilter = (from: string, to: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (from) params.set('dateFrom', from)
    else params.delete('dateFrom')
    if (to) params.set('dateTo', to)
    else params.delete('dateTo')
    router.push(`/?${params}`)
  }

  const clearFilter = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('dateFrom')
    params.delete('dateTo')
    router.push(`/?${params}`)
  }

  const now = new Date()
  const today = toJSTDate(now)
  const yesterday = toJSTDate(new Date(now.getTime() - 86400000))
  const weekStart = (() => {
    const d = new Date(now)
    d.setDate(d.getDate() - d.getDay())
    return toJSTDate(d)
  })()
  const monthStart = toJSTDate(new Date(now.getFullYear(), now.getMonth(), 1))

  const presets = [
    { label: '今日', from: today, to: today },
    { label: '昨日', from: yesterday, to: yesterday },
    { label: '今週', from: weekStart, to: today },
    { label: '今月', from: monthStart, to: today },
  ]

  const isActive = !!(dateFrom || dateTo)

  return (
    <div className="px-1">
      <h3 className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
        <CalendarDays className="w-3 h-3" />
        Date Filter
        {isActive && (
          <button
            onClick={clearFilter}
            className="ml-auto text-muted-foreground/70 hover:text-zinc-700 transition-colors"
            title="フィルタ解除"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </h3>

      {isActive && (
        <div className="text-[10px] text-primary bg-accent border border-primary/25 rounded px-2 py-1 mb-2 truncate">
          {dateFrom === dateTo
            ? dateFrom
            : `${dateFrom || '…'} 〜 ${dateTo || '…'}`}
        </div>
      )}

      {/* Preset buttons */}
      <div className="grid grid-cols-2 gap-1 mb-2">
        {presets.map((p) => {
          const active = dateFrom === p.from && dateTo === p.to
          return (
            <button
              key={p.label}
              onClick={() => applyFilter(p.from, p.to)}
              className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                active
                  ? 'bg-accent border-primary/40 text-accent-foreground'
                  : 'bg-card border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {/* Custom date range */}
      <div className="space-y-1">
        <input
          type="date"
          value={localFrom}
          max={localTo || today}
          onChange={(e) => setLocalFrom(e.target.value)}
          onBlur={() => applyFilter(localFrom, localTo || localFrom)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter(localFrom, localTo || localFrom)
          }}
          className="w-full bg-card border border-border rounded px-2 py-1 text-[11px] text-muted-foreground focus:outline-none focus:border-primary/40 focus:bg-secondary transition-colors cursor-pointer [color-scheme:dark]"
        />
        <input
          type="date"
          value={localTo}
          min={localFrom || undefined}
          max={today}
          onChange={(e) => setLocalTo(e.target.value)}
          onBlur={() => applyFilter(localFrom || localTo, localTo)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter(localFrom || localTo, localTo)
          }}
          className="w-full bg-card border border-border rounded px-2 py-1 text-[11px] text-muted-foreground focus:outline-none focus:border-primary/40 focus:bg-secondary transition-colors cursor-pointer [color-scheme:dark]"
        />
      </div>
    </div>
  )
}

export function DateFilterClient() {
  return (
    <Suspense fallback={<div className="px-1 h-24 bg-card rounded animate-pulse" />}>
      <DateFilterInner />
    </Suspense>
  )
}
