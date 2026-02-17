'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"
import { toast } from "sonner"
import Link from 'next/link'

import { GroupedArticle } from '@/lib/types'

export function ArticleCard({ article }: { article: GroupedArticle }) {
    const [isVisible, setIsVisible] = useState(true)
    const [imageLoaded, setImageLoaded] = useState(true) // Start visible to avoid hydration mismatch
    const [imageError, setImageError] = useState(false)
    const categories = article.category.split(',').filter(c => c.trim())
    const relatedCount = article.related?.length || 0;

    // Nutrient scores with defaults
    const factScore = article.fact_score ?? 0;
    const contextScore = article.context_score ?? 0;
    const perspectiveScore = article.perspective_score ?? 0;
    const emotionScore = article.emotion_score ?? 0;
    const immediacyScore = article.immediacy_score ?? 0;
    const hasNutrients = factScore > 0 || contextScore > 0;

    const logInteraction = async (type: string) => {
        try {
            await fetch('/api/interact', {
                method: 'POST',
                body: JSON.stringify({ articleId: article.id, type }),
            })
        } catch (e) {
            console.error('Failed to log interaction', e)
        }
    }

    const handleNotInterested = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsVisible(false) // Optimistic update
        toast.info("記事を表示しないように設定しました")
        await logInteraction('not_interested')
    }

    if (!isVisible) return null

    const hasImage = article.image_url && !imageError

    return (
        <Card className="h-full border-white/10 bg-white/5 backdrop-blur-sm hover:border-sky-500/30 hover:shadow-lg hover:shadow-sky-900/10 transition-all duration-300 group flex flex-col overflow-hidden relative">
            <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full bg-black/40 hover:bg-red-500/80 text-white/70 hover:text-white backdrop-blur-md"
                    onClick={handleNotInterested}
                    title="興味なし"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <Link href={`/article/${article.id}`} className="block flex-grow" onClick={() => logInteraction('view')}>
                {hasImage && (
                    <div className="relative h-32 w-full overflow-hidden bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={article.image_url!}
                            alt=""
                            className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                            onLoad={() => setImageLoaded(true)}
                            onError={() => setImageError(true)}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent" />
                    </div>
                )}

                <CardHeader className="p-3 pb-1 space-y-1">
                    <div className="flex flex-wrap gap-1.5 pr-6">
                        {relatedCount > 0 && (
                            <Badge
                                variant="outline"
                                className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[9px] px-1 py-0 h-4 font-bold"
                            >
                                {relatedCount + 1} SOURCES
                            </Badge>
                        )}
                        {categories.slice(0, 2).map((cat) => (
                            <Badge
                                key={cat}
                                variant="secondary"
                                className="bg-sky-500/10 text-sky-400 border-sky-500/20 text-[9px] px-1 py-0 h-4"
                            >
                                {cat}
                            </Badge>
                        ))}
                        <span className="text-[9px] text-slate-500 flex items-center ml-auto">
                            {article.published?.substring(0, 10)}
                        </span>
                    </div>

                    {/* Nutrient Badges (Mini) */}
                    {hasNutrients && (
                        <div className="flex flex-wrap gap-1 mb-1">
                            {factScore > 50 && <Badge variant="outline" className="text-[10px] py-0 h-5 border-blue-500/30 text-blue-400 bg-blue-500/10">事実高</Badge>}
                            {contextScore > 50 && <Badge variant="outline" className="text-[10px] py-0 h-5 border-amber-500/30 text-amber-400 bg-amber-500/10">背景深</Badge>}
                            {perspectiveScore > 50 && <Badge variant="outline" className="text-[10px] py-0 h-5 border-purple-500/30 text-purple-400 bg-purple-500/10">視点多</Badge>}
                            {emotionScore > 50 && <Badge variant="outline" className="text-[10px] py-0 h-5 border-pink-500/30 text-pink-400 bg-pink-500/10">感情的</Badge>}
                            {immediacyScore > 50 && <Badge variant="outline" className="text-[10px] py-0 h-5 border-cyan-500/30 text-cyan-400 bg-cyan-500/10">速報</Badge>}
                        </div>
                    )}

                    <CardTitle className="text-sm font-bold leading-snug group-hover:text-sky-400 transition-colors line-clamp-2">
                        {article.title}
                    </CardTitle>
                </CardHeader>

                <CardContent className="p-3 pt-0">
                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {article.summary}
                    </p>
                </CardContent>
            </Link>
        </Card>
    )
}
