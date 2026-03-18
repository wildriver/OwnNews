'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

// RSS categories from ceek.jp feeds
export const RSS_CATEGORIES = [
  'IT',
  'スポーツ',
  'エンターテイメント',
  '地方・地域',
  '訃報・人事',
  'サイエンス',
  '中国・韓国',
  'その他',
] as const

interface CategoryFilterBarProps {
  onExcludeChange: (excluded: Set<string>) => void
}

export function CategoryFilterBar({ onExcludeChange }: CategoryFilterBarProps) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const toggle = (cat: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(cat)) {
        next.delete(cat)
      } else {
        next.add(cat)
      }
      onExcludeChange(next)
      return next
    })
  }

  const allOff = excluded.size === RSS_CATEGORIES.length
  const resetAll = () => {
    const empty = new Set<string>()
    setExcluded(empty)
    onExcludeChange(empty)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-6">
      <span className="text-xs text-slate-500 mr-1 shrink-0">ジャンル:</span>
      {RSS_CATEGORIES.map(cat => {
        const isOff = excluded.has(cat)
        return (
          <Button
            key={cat}
            variant="ghost"
            size="sm"
            onClick={() => toggle(cat)}
            className={`h-6 px-2 text-xs rounded-full transition-all ${
              isOff
                ? 'text-slate-600 bg-transparent border border-slate-800 line-through opacity-50'
                : 'text-sky-300 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20'
            }`}
          >
            {cat}
          </Button>
        )
      })}
      {excluded.size > 0 && !allOff && (
        <Button
          variant="ghost"
          size="sm"
          onClick={resetAll}
          className="h-6 px-2 text-xs text-slate-500 hover:text-slate-300"
        >
          すべてON
        </Button>
      )}
    </div>
  )
}
