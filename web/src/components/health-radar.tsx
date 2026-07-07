'use client'

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// RSS categories from ceek.jp — fixed 8 axes for consistent radar shape
const RSS_CATEGORIES = ['IT', 'スポーツ', 'エンターテイメント', '地方・地域', '訃報・人事', 'サイエンス', '中国・韓国', 'その他']

interface HealthRadarInfoProps {
    distribution: Record<string, number>
    label?: string
}

export function HealthRadarInfo({ distribution, label }: HealthRadarInfoProps) {
    const maxVal = Math.max(...RSS_CATEGORIES.map(c => distribution[c] || 0), 1)

    // Always use the fixed 8 RSS categories so the radar shape is consistent
    const data = RSS_CATEGORIES.map(subject => ({
        subject,
        A: distribution[subject] || 0,
        fullMark: maxVal,
    }))

    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">ジャンルバランス</CardTitle>
                <CardDescription>{label || 'カテゴリー摂取バランス'}</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
                        <PolarGrid stroke="#E5E7E3" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#6E7672', fontSize: 12 }} />
                        <Radar
                            name="My Feed"
                            dataKey="A"
                            stroke="#0E9F6E"
                            strokeWidth={2}
                            fill="#0E9F6E"
                            fillOpacity={0.3}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
