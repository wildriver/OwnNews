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
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">栄養バランス</CardTitle>
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
