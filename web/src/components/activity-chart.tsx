'use client'

import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ActivityData {
    name: string
    count: number
    date?: string
}

interface ActivityBarChartProps {
    data: ActivityData[]
}

export function ActivityBarChart({ data }: ActivityBarChartProps) {
    return (
        <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-slate-200">週間アクティビティ</CardTitle>
                <CardDescription>日別の記事閲覧数 (過去7日間)</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                        <XAxis
                            dataKey="name"
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#94a3b8"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
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
                            radius={[4, 4, 0, 0]}
                            name="閲覧数"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
