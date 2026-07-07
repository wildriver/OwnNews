'use client'

import { useState } from 'react'
import { X, ChevronDown } from "lucide-react"
import { toast } from "sonner"
import Link from 'next/link'

import { GroupedArticle } from '@/lib/types'
import { recordInteraction } from '@/lib/client/interactions'
import { InteractionType } from '@/lib/client/types'
import { extractSourceName } from '@/lib/news'

interface ArticleCardProps {
    article: GroupedArticle
    outsideBubble?: boolean
    onCategoryClick?: (category: string) => void
    /** row = 高密度リスト行（既定） / featured = セクション先頭の大型カード */
    variant?: 'row' | 'featured'
}

// 栄養素のうち特徴的なもの（60以上）を最大2つ、控えめなテキストラベルで示す
const NUTRIENT_DEFS = [
    { key: 'fact_score', label: '事実', dot: 'bg-blue-500' },
    { key: 'context_score', label: '背景', dot: 'bg-amber-500' },
    { key: 'perspective_score', label: '視点', dot: 'bg-violet-500' },
    { key: 'emotion_score', label: '感情', dot: 'bg-pink-500' },
    { key: 'immediacy_score', label: '速報', dot: 'bg-cyan-600' },
] as const

function topNutrients(article: GroupedArticle) {
    return NUTRIENT_DEFS
        .map(d => ({ ...d, score: (article as unknown as Record<string, number>)[d.key] ?? 0 }))
        .filter(d => d.score >= 60)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
}

function formatDate(published?: string, collectedAt?: string): string {
    const raw = published || collectedAt || ''
    const d = new Date(raw)
    if (isNaN(d.getTime())) return raw.substring(0, 10)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
    return `${d.getMonth() + 1}/${d.getDate()}`
}

export function ArticleCard({ article, outsideBubble, onCategoryClick, variant = 'row' }: ArticleCardProps) {
    const [isVisible, setIsVisible] = useState(true)
    const [expanded, setExpanded] = useState(false)
    const [imageError, setImageError] = useState(false)

    const category = (article.category || '').split(',').map(c => c.trim()).filter(Boolean)[0]
    const relatedCount = article.related?.length || 0
    const nutrients = topNutrients(article)
    const source = article.source || extractSourceName(article.link)
    const hasImage = !!article.image_url && !imageError

    const logInteraction = async (type: InteractionType) => {
        await recordInteraction(article.id, type)
    }

    const handleNotInterested = async (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setIsVisible(false)
        toast.info("この記事を表示しないようにしました")
        await logInteraction('not_interested')
    }

    if (!isVisible) return null

    // ---- 共通パーツ ----
    const metaChips = (
        <div className="flex items-center gap-1.5 min-w-0">
            {outsideBubble && (
                <span className="shrink-0 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-1 leading-4">
                    バブル外
                </span>
            )}
            {category && (
                <button
                    className={`shrink-0 text-[10px] font-medium text-accent-foreground bg-accent rounded-sm px-1 leading-4 ${onCategoryClick ? 'hover:opacity-70' : 'cursor-default'}`}
                    onClick={onCategoryClick ? (e) => {
                        e.preventDefault(); e.stopPropagation(); onCategoryClick(category)
                    } : undefined}
                    tabIndex={-1}
                >
                    {category}
                </button>
            )}
            {relatedCount > 0 && (
                <span className="shrink-0 text-[10px] font-medium text-primary border border-primary/30 rounded-sm px-1 leading-4 tnum">
                    {relatedCount + 1}紙
                </span>
            )}
        </div>
    )

    const metaBottom = (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground min-w-0">
            <span className="truncate font-medium">{source}</span>
            <span className="shrink-0 tnum">{formatDate(article.published, (article as unknown as { collected_at?: string }).collected_at)}</span>
            {nutrients.map(n => (
                <span key={n.key} className="hidden sm:inline-flex items-center gap-1 shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${n.dot}`} />
                    {n.label}
                </span>
            ))}
        </div>
    )

    const dismissButton = (
        <button
            onClick={handleNotInterested}
            title="興味なし（今後の推薦に反映）"
            className="absolute top-1.5 right-1.5 z-10 h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground/0 group-hover:text-muted-foreground group-hover:bg-secondary hover:!text-destructive transition-colors"
        >
            <X className="h-3.5 w-3.5" />
        </button>
    )

    const relatedList = relatedCount > 0 && (
        <div className="mt-1">
            <button
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(v => !v) }}
            >
                他{relatedCount}紙の報道
                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
            {expanded && (
                <div className="mt-1 space-y-1">
                    {article.related?.slice(0, 3).map(r => (
                        <Link
                            key={r.id}
                            href={`/article/${r.id}`}
                            onClick={(e) => { e.stopPropagation(); logInteraction('view') }}
                            className="flex items-baseline gap-1.5 group/rel"
                        >
                            <span className="shrink-0 text-[10px] text-muted-foreground/70">
                                {r.source || extractSourceName(r.link)}
                            </span>
                            <span className="text-[11px] text-muted-foreground line-clamp-1 group-hover/rel:text-primary transition-colors">
                                {r.title}
                            </span>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )

    // ---- featured: セクション先頭の大型カード ----
    if (variant === 'featured') {
        return (
            <div className="relative group">
                {dismissButton}
                <Link href={`/article/${article.id}`} onClick={() => logInteraction('view')} className="block">
                    {hasImage && (
                        <div className="relative w-full aspect-[2/1] overflow-hidden bg-muted">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={article.image_url!}
                                alt=""
                                className="w-full h-full object-cover"
                                onError={() => setImageError(true)}
                            />
                        </div>
                    )}
                    <div className="px-3 py-2.5 space-y-1">
                        {metaChips}
                        <h3 className="text-[15px] font-bold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                            {article.title}
                        </h3>
                        <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2">
                            {article.summary}
                        </p>
                        {metaBottom}
                    </div>
                </Link>
                {relatedList && <div className="px-3 pb-2">{relatedList}</div>}
            </div>
        )
    }

    // ---- row: 高密度リスト行 ----
    return (
        <div className="relative group">
            {dismissButton}
            <Link
                href={`/article/${article.id}`}
                onClick={() => logInteraction('view')}
                className="flex gap-3 px-3 py-2.5"
            >
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {metaChips}
                    <h3 className="text-[13px] font-bold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                        {article.title}
                    </h3>
                    <div className="mt-auto">{metaBottom}</div>
                </div>
                {hasImage && (
                    <div className="shrink-0 w-[88px] h-[64px] rounded-md overflow-hidden bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={article.image_url!}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={() => setImageError(true)}
                        />
                    </div>
                )}
            </Link>
            {relatedList && <div className="px-3 pb-2 -mt-1">{relatedList}</div>}
        </div>
    )
}
