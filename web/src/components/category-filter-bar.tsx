'use client'

import { useState, useEffect } from 'react'

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

export function loadExcluded(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return new Set()
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) return new Set(parsed as string[])
  } catch { /* ignore */ }
  return new Set()
}

export function saveExcluded(excluded: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(excluded)))
  } catch { /* ignore */ }
}

interface CategoryFilterBarProps {
  /** 親が保持する除外状態（制御コンポーネント）。省略時は自身のlocalStorageを使用 */
  excluded?: Set<string>
  onExcludeChange: (excluded: Set<string>) => void
}

// ジャンルON/OFFチップ列。1行の横スクロールで密度を保つ。
// 除外状態は localStorage + 運営Supabase に保存され、端末間で同期される。
export function CategoryFilterBar({ excluded: controlledExcluded, onExcludeChange }: CategoryFilterBarProps) {
  const [internalExcluded, setInternalExcluded] = useState<Set<string>>(new Set())
  const excluded = controlledExcluded ?? internalExcluded

  // 制御されていない場合のみ localStorage から初期値を復元
  useEffect(() => {
    if (controlledExcluded !== undefined) return
    const saved = loadExcluded()
    if (saved.size > 0) {
      setInternalExcluded(saved)
      setTimeout(() => onExcludeChange(saved), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (cat: string) => {
    const next = new Set(excluded)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    setInternalExcluded(next)
    saveExcluded(next)
    onExcludeChange(next)
  }

  const resetAll = () => {
    const empty = new Set<string>()
    setInternalExcluded(empty)
    saveExcluded(empty)
    onExcludeChange(empty)
  }

  return (
    <div className="flex items-center gap-1.5 mb-3 overflow-x-auto no-scrollbar -mx-1 px-1 py-0.5">
      {RSS_CATEGORIES.map(cat => {
        const isOff = excluded.has(cat)
        return (
          <button
            key={cat}
            onClick={() => toggle(cat)}
            className={`shrink-0 h-7 px-2.5 text-[11px] font-medium rounded-full border transition-colors ${isOff
              ? 'text-muted-foreground/60 bg-transparent border-border line-through'
              : 'text-accent-foreground bg-accent border-transparent hover:opacity-80'
              }`}
          >
            {cat}
          </button>
        )
      })}
      {excluded.size > 0 && (
        <button
          onClick={resetAll}
          className="shrink-0 h-7 px-2.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          すべてON
        </button>
      )}
    </div>
  )
}
