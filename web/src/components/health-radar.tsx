'use client'

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ONBOARDING_CATEGORIES } from '@/lib/types'

interface HealthRadarInfoProps {
    distribution: Record<string, number>
    label?: string
}

// 軸は多様性スコアの分母（ONBOARDING_CATEGORIES=12ジャンル）と同一にする。
// 以前は8軸に固定しており、政治・経済・国際・社会がレーダーに出ていなかった。
// これらは多様性スコアの分母には入っているため、「読んでいないと減点されるのに
// 鏡には映らない」状態になっていた。情報的健康の文脈では最も見えるべき4ジャンルであり、
// スコアと可視化は同じ空間を指していなければならない。
// 定数を共有することで、以降ジャンルを増減しても両者がずれない。
export function HealthRadarInfo({ distribution, label }: HealthRadarInfoProps) {
    const maxVal = Math.max(...ONBOARDING_CATEGORIES.map(c => distribution[c] || 0), 1)

    const data = ONBOARDING_CATEGORIES.map(subject => ({
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
            {/* 8軸から12軸に増えたぶん、ラベルの重なりを避けて高さと余白を広げ、
                文字を少し小さくする（「エンターテイメント」が最長） */}
            <CardContent className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="72%" data={data}>
                        <PolarGrid stroke="#E5E7E3" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#6E7672', fontSize: 10 }} />
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
