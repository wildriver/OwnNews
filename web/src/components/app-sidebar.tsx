import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { LayoutDashboard, Newspaper, Settings, LogOut, Activity, History } from 'lucide-react'
import Link from 'next/link'
import { HealthStats } from '@/lib/types'
import { User } from '@supabase/supabase-js'

interface AppSidebarProps {
    user: User
    healthStats: HealthStats | null
}

export function AppSidebar({ user, healthStats }: AppSidebarProps) {
    const getScoreColor = (score: number) => {
        if (score >= 70) return "text-emerald-400"
        if (score >= 40) return "text-amber-400"
        return "text-rose-400"
    }

    return (
        <aside className="w-64 border-r border-white/10 bg-slate-950/50 backdrop-blur-xl hidden md:flex flex-col h-full">
            <div className="p-6 pb-2">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent mb-1">
                    OwnNews
                </h1>
                <p className="text-xs text-slate-500">AI News Curator</p>
            </div>

            <ScrollArea className="flex-1 px-4 py-2">
                <div className="space-y-6">
                    <nav className="space-y-1">
                        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-slate-100 hover:bg-white/5" asChild>
                            <Link href="/">
                                <Newspaper className="mr-2 h-4 w-4" />
                                News Feed
                            </Link>
                        </Button>
                        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-slate-100 hover:bg-white/5" asChild>
                            <Link href="/dashboard">
                                <LayoutDashboard className="mr-2 h-4 w-4" />
                                Dashboard
                            </Link>
                        </Button>
                        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-slate-100 hover:bg-white/5" asChild>
                            <Link href="/history">
                                <History className="mr-2 h-4 w-4" />
                                History
                            </Link>
                        </Button>
                        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-slate-100 hover:bg-white/5" asChild>
                            <Link href="/settings">
                                <Settings className="mr-2 h-4 w-4" />
                                Settings
                            </Link>
                        </Button>
                    </nav>

                    <Separator className="bg-white/10" />

                    {healthStats && (
                        <div className="px-1">
                            <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                                <Activity className="w-3 h-3" />
                                Information Health
                            </h3>

                            <div className="bg-white/5 rounded-lg p-3 space-y-4 border border-white/5">
                                <div>
                                    <div className="text-xs text-slate-400 mb-1">Diversity Score</div>
                                    <div className={`text-2xl font-bold ${getScoreColor(healthStats.diversity_score)}`}>
                                        {healthStats.diversity_score}/100
                                    </div>
                                </div>

                                <div>
                                    <div className="text-xs text-slate-400 mb-1">Bias Level</div>
                                    <div className="text-sm font-medium text-slate-200">
                                        {healthStats.bias_level}
                                    </div>
                                    {healthStats.dominant_category && (
                                        <div className="text-xs text-slate-500 mt-1">
                                            Most: {healthStats.dominant_category} ({Math.round(healthStats.dominant_ratio * 100)}%)
                                        </div>
                                    )}
                                </div>

                                {healthStats.missing_categories.length > 0 && (
                                    <div className="pt-2 border-t border-white/10">
                                        <div className="text-[10px] text-slate-500 mb-2">Suggestions</div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {healthStats.missing_categories.slice(0, 3).map(c => (
                                                <span key={c} className="text-[10px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-300 rounded border border-indigo-500/20">
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

            <div className="p-4 border-t border-white/10 mt-auto">
                <div className="flex items-center gap-3 mb-4 px-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-sky-500 to-indigo-500 flex items-center justify-center text-xs font-bold text-white">
                        {user.email?.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-200 truncate">
                            {user.email?.split('@')[0]}
                        </div>
                        <div className="text-xs text-slate-500 truncate">Free Plan</div>
                    </div>
                </div>
                <form action="/auth/signout" method="post">
                    <Button variant="outline" className="w-full justify-start text-slate-400 border-white/10 hover:bg-white/5 hover:text-white" type="submit">
                        <LogOut className="mr-2 h-4 w-4" />
                        Sign out
                    </Button>
                </form>
            </div>
        </aside>
    )
}
