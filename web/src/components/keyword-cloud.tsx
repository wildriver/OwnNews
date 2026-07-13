'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface KeywordBarProps {
    data: { keyword: string; count: number }[]
    onSelect?: (keyword: string) => void
}

// 頻度に応じて文字サイズ・太さ・濃さを段階的に変えるタグクラウド。
// 件数の細かい数字は出さず、「大きい＝よく読んでいる関心」を直感的に見せる
// （「足りない栄養素」チップと同じ、数字を出さないチップ表現の仲間）。
const TIERS = [
    // 大きい順。上位ほど濃く・太く・大きく
    { text: 'text-2xl', weight: 'font-bold', tone: 'bg-primary/15 text-primary border-primary/30' },
    { text: 'text-xl', weight: 'font-bold', tone: 'bg-primary/10 text-primary border-primary/25' },
    { text: 'text-lg', weight: 'font-semibold', tone: 'bg-secondary text-foreground border-border' },
    { text: 'text-base', weight: 'font-medium', tone: 'bg-secondary text-foreground border-border' },
    { text: 'text-[13px]', weight: 'font-medium', tone: 'bg-secondary text-muted-foreground border-border' },
    { text: 'text-[11px]', weight: 'font-normal', tone: 'bg-secondary text-muted-foreground border-border' },
]

export function KeywordBar({ data, onSelect }: KeywordBarProps) {
    if (data.length === 0) {
        return (
            <Card className="border-border bg-card">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-foreground">注目キーワード</CardTitle>
                    <CardDescription>よく見ている記事のキーワード</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px] flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">まだデータがありません</p>
                </CardContent>
            </Card>
        )
    }

    const max = data[0]?.count || 1
    const min = data[data.length - 1]?.count || 1
    // 件数を6段階のティアに割り当て（最頻=0＝最大、最少=5＝最小）
    const tierOf = (count: number) => {
        if (max === min) return 2  // 全部同数なら中庸サイズ
        const ratio = (count - min) / (max - min)   // 0..1
        return Math.min(TIERS.length - 1, Math.round((1 - ratio) * (TIERS.length - 1)))
    }

    return (
        <Card className="border-border bg-card">
            <CardHeader>
                <CardTitle className="text-lg font-bold text-foreground">注目キーワード</CardTitle>
                <CardDescription>
                    よく読んでいるキーワードほど大きく表示
                    {onSelect && '（クリックで読んだ記事一覧へ）'}
                </CardDescription>
            </CardHeader>
            <CardContent className="min-h-[220px]">
                <div className="flex flex-wrap items-center gap-2">
                    {data.map(({ keyword, count }) => {
                        const t = TIERS[tierOf(count)]
                        const Tag = onSelect ? 'button' : 'span'
                        return (
                            <Tag
                                key={keyword}
                                onClick={onSelect ? () => onSelect(keyword) : undefined}
                                title={`${keyword}（${count}件）`}
                                className={`inline-flex items-center rounded-lg border px-2.5 py-1 leading-none transition-colors ${t.text} ${t.weight} ${t.tone} ${onSelect ? 'cursor-pointer hover:border-primary/50 hover:text-primary' : ''}`}
                            >
                                {keyword}
                            </Tag>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
}
