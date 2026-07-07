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
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">週間アクティビティ</CardTitle>
                <CardDescription>日別の記事閲覧数 (過去7日間)</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data}>
                        <XAxis
                            dataKey="name"
                            stroke="#6E7672"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#6E7672"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            allowDecimals={false}
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
                            radius={[4, 4, 0, 0]}
                            name="閲覧数"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
