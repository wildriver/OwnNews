'use client'

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface KeywordBarProps {
    data: { keyword: string; count: number }[]
}

export function KeywordBar({ data }: KeywordBarProps) {
    if (data.length === 0) {
        return (
            <Card className="border-border bg-card">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-foreground">注目キーワード</CardTitle>
                    <CardDescription>よく見ている記事のキーワード Top10</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px] flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">まだデータがありません</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">注目キーワード</CardTitle>
                <CardDescription>よく見ている記事のキーワード Top10</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <XAxis
                            type="number"
                            stroke="#6E7672"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="keyword"
                            stroke="#6E7672"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            width={80}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#E5E7E3', color: '#1A1C1A' }}
                            itemStyle={{ color: '#0E9F6E' }}
                            cursor={{ fill: '#F0F1EF' }}
                            labelStyle={{ color: '#6E7672' }}
                        />
                        <Bar
                            dataKey="count"
                            fill="#2563EB"
                            radius={[0, 4, 4, 0]}
                            name="件数"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
