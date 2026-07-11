import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts'

interface NutrientRadarProps {
    fact: number
    context: number
    perspective: number
    emotion: number
    immediacy: number
    className?: string
}

export function NutrientRadar({ fact, context, perspective, emotion, immediacy, className }: NutrientRadarProps) {
    // 軸ラベルは日本語のみに短縮。日英併記だと狭いカラムでは英語部分が
    // 「ediacy)」のように断片表示され意味不明になるため。
    const data = [
        { subject: '事実', A: fact, fullMark: 100 },
        { subject: '背景', A: context, fullMark: 100 },
        { subject: '視点', A: perspective, fullMark: 100 },
        { subject: '感情', A: emotion, fullMark: 100 },
        { subject: '速報', A: immediacy, fullMark: 100 },
    ]

    return (
        <div className={className} style={{ width: '100%', height: '100%', minHeight: '200px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis
                        dataKey="subject"
                        tick={{ fill: '#94a3b8', fontSize: 11 }}
                    />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                        name="Nutrients"
                        dataKey="A"
                        stroke="#0E9F6E"
                        strokeWidth={2}
                        fill="#0E9F6E"
                        fillOpacity={0.3}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    )
}
