'use client'

// 閲覧履歴（ローカル版）— IndexedDB内の履歴を表示する。サーバ問い合わせなし。

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Clock, XCircle, ExternalLink, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { getAllInteractions } from '@/lib/client/store'
import { LocalInteraction } from '@/lib/client/types'

export default function HistoryPage() {
    const [interactions, setInteractions] = useState<LocalInteraction[] | null>(null)

    useEffect(() => {
        getAllInteractions().then(ints =>
            setInteractions(ints.sort((a, b) => b.created_at.localeCompare(a.created_at)))
        )
    }, [])

    if (!interactions) {
        return (
            <div className="min-h-screen flex items-center justify-center text-slate-500">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        )
    }

    const viewed = interactions.filter(i => i.type === 'view' || i.type === 'deep_dive')
    const excluded = interactions.filter(i => i.type === 'not_interested')

    const HistoryList = ({ items }: { items: LocalInteraction[] }) => {
        if (items.length === 0) {
            return (
                <div className="text-center py-12 text-slate-500">
                    履歴はありません
                </div>
            )
        }

        return (
            <ScrollArea className="h-[600px] w-full pr-4">
                <div className="space-y-4">
                    {items.map((item) => (
                        <Card key={`${item.article_id}-${item.type}`} className="bg-white/5 border-white/10 hover:bg-white/10 transition-colors">
                            <CardContent className="p-4 flex items-start justify-between gap-4">
                                <div className="space-y-2">
                                    <h4 className="font-medium text-slate-200 line-clamp-2">
                                        <Link href={`/article/${item.article_id}`} className="hover:text-sky-400 transition-colors flex items-center gap-2">
                                            {item.title || '（タイトル不明）'}
                                        </Link>
                                    </h4>
                                    <div className="flex items-center gap-3 text-xs text-slate-400">
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {new Date(item.created_at).toLocaleString('ja-JP')}
                                        </span>
                                        {item.category && (
                                            <Badge variant="secondary" className="bg-slate-800 text-slate-300 text-[10px] h-5 px-1.5">
                                                {item.category.split(',')[0]}
                                            </Badge>
                                        )}
                                        {item.type === 'deep_dive' && (
                                            <Badge variant="outline" className="text-indigo-400 border-indigo-500/30 text-[10px] h-5 px-1.5">
                                                Deep Dive
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                                {item.link && (
                                    <a
                                        href={item.link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-slate-500 hover:text-slate-300"
                                    >
                                        <ExternalLink className="w-4 h-4" />
                                    </a>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </ScrollArea>
        )
    }

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-8">
                <header className="flex items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
                            Activity History
                        </h1>
                        <p className="text-slate-400">閲覧履歴と非表示設定の管理（この端末内のデータ）</p>
                    </div>
                </header>

                <Tabs defaultValue="viewed" className="w-full">
                    <TabsList className="grid w-full grid-cols-2 bg-white/5 p-1 mb-8">
                        <TabsTrigger value="viewed" className="data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-400">
                            閲覧履歴 ({viewed.length})
                        </TabsTrigger>
                        <TabsTrigger value="excluded" className="data-[state=active]:bg-red-500/20 data-[state=active]:text-red-400">
                            非表示リスト ({excluded.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="viewed">
                        <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="text-lg">最近読んだ記事</CardTitle>
                                <CardDescription>過去の閲覧・分析履歴</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <HistoryList items={viewed} />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="excluded">
                        <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="text-lg text-red-400 flex items-center gap-2">
                                    <XCircle className="w-5 h-5" />
                                    興味なしとして除外
                                </CardTitle>
                                <CardDescription>非表示に設定された記事</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <HistoryList items={excluded} />
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    )
}
