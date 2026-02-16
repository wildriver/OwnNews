'use client'

import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface HealthRadarInfoProps {
    distribution: Record<string, number>
    label?: string
}

export function HealthRadarInfo({ distribution, label }: HealthRadarInfoProps) {
    // Transform distribution to chart data
    // Normalize to 100 for better radar visualization (relative to max)
    const maxVal = Math.max(...Object.values(distribution), 1);

    // Ensure we have some default categories if empty
    const subjects = Object.keys(distribution).length > 0
        ? Object.keys(distribution)
        : ['政治', '経済', '国際', 'IT', '社会', 'エンタメ'];

    const data = subjects.map(subject => ({
        subject,
        A: distribution[subject] || 0,
        fullMark: maxVal > 0 ? maxVal : 10 // scale based on max
    }));

    // If we have very few categories, add some dummy ones with 0 to make the radar look like a radar
    if (data.length < 3) {
        const defaults = ['政治', '経済', 'IT'].filter(d => !subjects.includes(d));
        defaults.forEach(d => data.push({ subject: d, A: 0, fullMark: maxVal }));
    }

    return (
        <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-slate-200">Information Health</CardTitle>
                <CardDescription>{label || 'カテゴリー摂取バランス'}</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
                        <PolarGrid stroke="rgba(255,255,255,0.1)" />
                        <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                        <Radar
                            name="My Feed"
                            dataKey="A"
                            stroke="#38BDF8"
                            strokeWidth={2}
                            fill="#38BDF8"
                            fillOpacity={0.3}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    )
}
