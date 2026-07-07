'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { LayoutDashboard, Newspaper, Settings, Activity, History, ShieldCheck } from 'lucide-react'
import { HealthStats } from '@/lib/types'
import { DateFilterClient } from '@/components/date-filter-client'
import { getAllInteractions } from '@/lib/client/store'
import { computeHealthStats } from '@/lib/client/health-local'
import { INTERACTION_EVENT } from '@/lib/client/interactions'
import { getPersonalConfig } from '@/lib/client/personal'

const NAV_ITEMS = [
    { href: '/', label: 'ニュース', icon: Newspaper },
    { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
    { href: '/history', label: '履歴', icon: History },
    { href: '/settings', label: '設定', icon: Settings },
]

export function AppSidebar() {
    const pathname = usePathname()
    const [healthStats, setHealthStats] = useState<HealthStats | null>(null)
    const [hasPersonalDB, setHasPersonalDB] = useState(false)

    useEffect(() => {
        let cancelled = false
        const load = async () => {
            try {
                const interactions = await getAllInteractions()
                if (!cancelled) setHealthStats(computeHealthStats(interactions, '30d'))
            } catch { /* IndexedDB未対応環境では統計非表示 */ }
        }
        load()
        setHasPersonalDB(!!getPersonalConfig())
        window.addEventListener(INTERACTION_EVENT, load)
        return () => {
            cancelled = true
            window.removeEventListener(INTERACTION_EVENT, load)
        }
    }, [])

    const getScoreColor = (score: number) => {
        if (score >= 70) return 'text-primary'
        if (score >= 40) return 'text-amber-600'
        return 'text-rose-600'
    }

    return (
        <aside className="w-60 border-r border-border bg-sidebar hidden md:flex flex-col h-full">
            <div className="px-5 pt-5 pb-3">
                <h1 className="text-xl font-bold tracking-tight text-primary">OwnNews</h1>
                <p className="text-[10px] text-muted-foreground mt-0.5">情報的健康を保つニュース</p>
            </div>

            <ScrollArea className="flex-1 px-3 py-1">
                <div className="space-y-4">
                    <nav className="space-y-0.5">
                        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                            const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                            return (
                                <Link
                                    key={href}
                                    href={href}
                                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${active
                                        ? 'bg-accent text-accent-foreground'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                                        }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {label}
                                </Link>
                            )
                        })}
                    </nav>

                    <Separator className="bg-border" />

                    <DateFilterClient />

                    <Separator className="bg-border" />

                    {healthStats && (
                        <div className="px-1">
                            <h3 className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
                                <Activity className="w-3 h-3" />
                                情報的健康
                            </h3>

                            <div className="bg-card rounded-lg p-3 space-y-3 border border-border">
                                <div>
                                    <div className="text-[10px] text-muted-foreground mb-0.5">多様性スコア</div>
                                    <div className={`text-xl font-bold tnum ${getScoreColor(healthStats.diversity_score)}`}>
                                        {healthStats.diversity_score}
                                        <span className="text-[11px] font-normal text-muted-foreground">/100</span>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] text-muted-foreground mb-0.5">摂取バランス</div>
                                    <div className="text-[13px] font-medium">{healthStats.bias_level}</div>
                                    {healthStats.dominant_category && (
                                        <div className="text-[10px] text-muted-foreground mt-0.5">
                                            最多: {healthStats.dominant_category}（{Math.round(healthStats.dominant_ratio * 100)}%）
                                        </div>
                                    )}
                                </div>

                                {healthStats.missing_categories.length > 0 && (
                                    <div className="pt-2 border-t border-border">
                                        <div className="text-[10px] text-muted-foreground mb-1.5">足りない栄養</div>
                                        <div className="flex flex-wrap gap-1">
                                            {healthStats.missing_categories.slice(0, 3).map(c => (
                                                <span key={c} className="text-[10px] px-1.5 py-0.5 bg-secondary text-secondary-foreground rounded border border-border">
                                                    {c}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className="p-4 border-t border-border mt-auto">
                <div className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground">
                    <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-primary/70 mt-0.5" />
                    <span>
                        嗜好データはこの端末内
                        {hasPersonalDB && 'とあなたの個人DB'}
                        にのみ保存されています
                    </span>
                </div>
            </div>
        </aside>
    )
}
