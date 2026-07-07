'use client'

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend, CartesianGrid } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface TopicTransitionChartProps {
    series: {
        date: string
        counts: Record<string, number>
    }[]
}

export function TopicTransitionChart({ series }: TopicTransitionChartProps) {
    // Get all unique categories across all time points
    const categories = Array.from(
        new Set(series.flatMap((s) => Object.keys(s.counts)))
    ).slice(0, 5) // Show top 5 for clarity

    // Transform series to chart data
    const chartData = series.map((s) => ({
        name: s.date,
        ...s.counts,
    }))

    const colors = ['#0E9F6E', '#2563EB', '#fb7185', '#0E9F6E', '#fbbf24']

    return (
        <Card className="border-border bg-card col-span-1 md:col-span-2">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">興味の変遷</CardTitle>
                <CardDescription>トピック別の関心度の推移</CardDescription>
            </CardHeader>
            <CardContent className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0F1EF" />
                        <XAxis
                            dataKey="name"
                            stroke="#64748b"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                        />
                        <YAxis
                            stroke="#64748b"
                            fontSize={12}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `${value}`}
                        />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#1e293b',
                                border: '1px solid #E5E7E3',
                                borderRadius: '8px',
                            }}
                            itemStyle={{ fontSize: '12px' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
                        {categories.map((cat, i) => (
                            <Line
                                key={cat}
                                type="monotone"
                                dataKey={cat}
                                stroke={colors[i % colors.length]}
                                strokeWidth={2}
                                dot={{ r: 4, fill: colors[i % colors.length] }}
                                activeDot={{ r: 6 }}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
