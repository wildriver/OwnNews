'use client'

import { useState } from 'react'
import { NewsGrid } from '@/components/news-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

export function NewsFeedClient({ articles }: { articles: GroupedArticle[] }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const filtered = selectedCategory
    ? articles.filter(a => {
        const cats = a.category.split(',').map(c => c.trim())
        const medium = (a as unknown as Record<string, unknown>).category_medium as string | undefined
        return cats.includes(selectedCategory) || medium === selectedCategory
      })
    : articles

  return (
    <div>
      {selectedCategory && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-400">ジャンルフィルタ:</span>
          <Badge className="bg-sky-500/20 text-sky-300 border border-sky-500/40 px-2 py-0.5">
            {selectedCategory}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-slate-400 hover:text-white hover:bg-white/10"
            onClick={() => setSelectedCategory(null)}
          >
            <X className="h-3 w-3 mr-1" />
            解除
          </Button>
          <span className="text-xs text-slate-500 ml-1">{filtered.length} 件</span>
        </div>
      )}
      <NewsGrid articles={filtered} onCategoryClick={setSelectedCategory} />
    </div>
  )
}
