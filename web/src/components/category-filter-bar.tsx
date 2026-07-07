'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

// カテゴリ一覧（CEEK.JPのRSSタグ + 公式RSSソースの既定カテゴリ）
// lib/types.ts の ONBOARDING_CATEGORIES と揃えること
export const RSS_CATEGORIES = [
  '政治',
  '経済',
  '国際',
  '社会',
  'IT',
  'スポーツ',
  'エンターテイメント',
  'サイエンス',
  '地方・地域',
  '中国・韓国',
  '訃報・人事',
  'その他',
] as const

const STORAGE_KEY = 'ownnews_excluded_categories'

function loadExcluded(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return new Set()
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) return new Set(parsed as string[])
  } catch { /* ignore */ }
  return new Set()
}

function saveExcluded(excluded: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(excluded)))
  } catch { /* ignore */ }
}

interface CategoryFilterBarProps {
  onExcludeChange: (excluded: Set<string>) => void
}

export function CategoryFilterBar({ onExcludeChange }: CategoryFilterBarProps) {
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // localStorage から初期値を復元
  useEffect(() => {
    const saved = loadExcluded()
    if (saved.size > 0) {
      setExcluded(saved)
      onExcludeChange(saved)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (cat: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(cat)) {
        next.delete(cat)
      } else {
        next.add(cat)
      }
      saveExcluded(next)
      onExcludeChange(next)
      return next
    })
  }

  const allOff = excluded.size === RSS_CATEGORIES.length
  const resetAll = () => {
    const empty = new Set<string>()
    setExcluded(empty)
    saveExcluded(empty)
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
