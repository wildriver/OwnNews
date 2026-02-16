'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface TopicTreemapProps {
    distribution: Record<string, number>
}

// Color palette for treemap cells
const COLORS = [
    '#38BDF8', '#818CF8', '#34D399', '#FBBF24', '#F87171',
    '#A78BFA', '#2DD4BF', '#FB923C', '#E879F9', '#60A5FA',
    '#4ADE80', '#F472B6', '#FACC15',
]

export function TopicTreemap({ distribution }: TopicTreemapProps) {
    const entries = Object.entries(distribution)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])

    if (entries.length === 0) {
        return (
            <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-slate-200">トピック詳細</CardTitle>
                    <CardDescription>中分類別の摂取バランス</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px] flex items-center justify-center">
                    <p className="text-slate-500 text-sm">まだデータがありません</p>
                </CardContent>
            </Card>
        )
    }

    const total = entries.reduce((sum, [, count]) => sum + count, 0)

    // Build treemap layout using a simple squarified algorithm approximation
    // We'll use CSS grid with calculated areas
    return (
        <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-slate-200">トピック詳細</CardTitle>
                <CardDescription>中分類別の摂取バランス</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-4 gap-1 h-[260px]">
                    {entries.slice(0, 12).map(([topic, count], i) => {
                        const ratio = count / total
                        // Minimum span of 1 column, max of 4
                        const colSpan = Math.max(1, Math.min(4, Math.round(ratio * 8)))
                        const rowSpan = ratio > 0.15 ? 2 : 1
                        const color = COLORS[i % COLORS.length]

                        return (
                            <div
                                key={topic}
                                className="rounded-lg flex flex-col items-center justify-center text-center p-2 transition-all hover:scale-[1.02] cursor-default"
                                style={{
                                    gridColumn: `span ${colSpan}`,
                                    gridRow: `span ${rowSpan}`,
                                    backgroundColor: `${color}15`,
                                    border: `1px solid ${color}30`,
                                }}
                            >
                                <span
                                    className="font-bold text-xs leading-tight truncate w-full"
                                    style={{ color }}
                                >
                                    {topic}
                                </span>
                                <span className="text-[10px] text-slate-500 mt-0.5">
                                    {count}件 ({Math.round(ratio * 100)}%)
                                </span>
                            </div>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
}
