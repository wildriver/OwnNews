'use client'

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface KeywordBarProps {
    data: { keyword: string; count: number }[]
}

export function KeywordBar({ data }: KeywordBarProps) {
    if (data.length === 0) {
        return (
            <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-slate-200">注目キーワード</CardTitle>
                    <CardDescription>よく見ている記事のキーワード Top10</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px] flex items-center justify-center">
                    <p className="text-slate-500 text-sm">まだデータがありません</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-slate-200">注目キーワード</CardTitle>
                <CardDescription>よく見ている記事のキーワード Top10</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20 }}>
                        <XAxis
                            type="number"
                            stroke="#94a3b8"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <YAxis
                            type="category"
                            dataKey="keyword"
                            stroke="#94a3b8"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            width={80}
                        />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: 'rgba(255,255,255,0.1)', color: '#f8fafc' }}
                            itemStyle={{ color: '#38bdf8' }}
                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                            labelStyle={{ color: '#94a3b8' }}
                        />
                        <Bar
                            dataKey="count"
                            fill="#818CF8"
                            radius={[0, 4, 4, 0]}
                            name="件数"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
