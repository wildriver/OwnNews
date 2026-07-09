'use client'

// Phase 2: 季節・時間帯の関心分析
//  - 月 × カテゴリの積み上げ棒（春はスポーツ多め・冬は減る 等）
//  - 時間帯別の閲覧数

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// カテゴリ色パレット（global-category-bar と近い系統）
const PALETTE = [
    '#0E9F6E', '#2563EB', '#D97706', '#7C3AED', '#DB2777',
    '#0891B2', '#65A30D', '#DC2626',
]

const axisStyle = { stroke: '#6E7672', fontSize: 12, tickLine: false, axisLine: false } as const
const tooltipStyle = { backgroundColor: '#FFFFFF', borderColor: '#E5E7E3', color: '#1A1C1A', fontSize: 12 }

interface SeasonalProps {
    data: Record<string, string | number>[]
    categories: string[]
    total: number
}

export function SeasonalCategoryChart({ data, categories, total }: SeasonalProps) {
    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">季節ごとの関心</CardTitle>
                <CardDescription>月別・カテゴリ別の閲覧数（過去12ヶ月）</CardDescription>
            </CardHeader>
            <CardContent className="h-[320px]">
                {total === 0 ? (
                    <div className="h-full flex items-center justify-center text-center text-sm text-muted-foreground px-6">
                        まだデータが少ないため表示できません。<br />
                        記事を読み続けると、季節ごとの関心の移り変わり（例: 春はスポーツ、冬は減る）が見えてきます。
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                            <XAxis dataKey="label" {...axisStyle} />
                            <YAxis {...axisStyle} allowDecimals={false} />
                            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#F0F1EF' }} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {categories.map((cat, i) => (
                                <Bar
                                    key={cat}
                                    dataKey={cat}
                                    stackId="cat"
                                    fill={PALETTE[i % PALETTE.length]}
                                    name={cat}
                                    radius={i === categories.length - 1 ? [3, 3, 0, 0] : undefined}
                                />
                            ))}
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    )
}

interface HourlyProps {
    data: { label: string; count: number }[]
}

export function HourlyActivityChart({ data }: HourlyProps) {
    const total = data.reduce((s, d) => s + d.count, 0)
    // ピーク時間帯を求めてサブタイトルに
    const peak = data.reduce((m, d) => (d.count > m.count ? d : m), data[0])
    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">時間帯の傾向</CardTitle>
                <CardDescription>
                    {total > 0 ? `よく読む時間帯: ${peak.label}時ごろ` : 'いつニュースを読んでいるか'}
                </CardDescription>
            </CardHeader>
            <CardContent className="h-[240px]">
                {total === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                        まだデータがありません
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                            <XAxis dataKey="label" {...axisStyle} interval={1} />
                            <YAxis {...axisStyle} allowDecimals={false} />
                            <Tooltip
                                contentStyle={tooltipStyle}
                                cursor={{ fill: '#F0F1EF' }}
                                labelFormatter={(l) => `${l}時台`}
                            />
                            <Bar dataKey="count" fill="#0E9F6E" radius={[3, 3, 0, 0]} name="閲覧数" />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    )
}
