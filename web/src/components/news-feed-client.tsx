'use client'

import { useRouter } from 'next/navigation'
import { NewsGrid } from '@/components/news-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { GroupedArticle } from '@/lib/types'

interface NewsFeedClientProps {
  articles: GroupedArticle[]
  selectedCategory?: string | null
}

export function NewsFeedClient({ articles, selectedCategory }: NewsFeedClientProps) {
  const router = useRouter()

  const handleCategoryClick = (cat: string) => {
    router.push(`/?category=${encodeURIComponent(cat)}`)
  }

  const handleClear = () => {
    router.push('/')
  }

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
            onClick={handleClear}
          >
            <X className="h-3 w-3 mr-1" />
            解除
          </Button>
          <span className="text-xs text-slate-500 ml-1">{articles.length} 件</span>
        </div>
      )}
      <NewsGrid articles={articles} onCategoryClick={handleCategoryClick} />
    </div>
  )
}
