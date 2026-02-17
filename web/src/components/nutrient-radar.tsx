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
    const data = [
        { subject: '事実 (Fact)', A: fact, fullMark: 100 },
        { subject: '背景 (Context)', A: context, fullMark: 100 },
        { subject: '視点 (Perspective)', A: perspective, fullMark: 100 },
        { subject: '感情 (Emotion)', A: emotion, fullMark: 100 },
        { subject: '速報 (Immediacy)', A: immediacy, fullMark: 100 },
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
                        stroke="#0ea5e9"
                        strokeWidth={2}
                        fill="#0ea5e9"
                        fillOpacity={0.3}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    )
}
