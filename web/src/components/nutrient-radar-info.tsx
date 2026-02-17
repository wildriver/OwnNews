import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClientNutrientRadar } from '@/components/client-nutrient-radar'

interface NutrientRadarInfoProps {
    averages: {
        fact: number
        context: number
        perspective: number
        emotion: number
        immediacy: number
    }
}

export function NutrientRadarInfo({ averages }: NutrientRadarInfoProps) {
    return (
        <Card className="border-white/10 bg-white/5 backdrop-blur-sm">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-slate-200">Nutrient Balance</CardTitle>
                <CardDescription>読んだ記事の栄養素平均</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ClientNutrientRadar
                    fact={averages.fact}
                    context={averages.context}
                    perspective={averages.perspective}
                    emotion={averages.emotion}
                    immediacy={averages.immediacy}
                    className="w-full h-full"
                />
            </CardContent>
        </Card>
    )
}
