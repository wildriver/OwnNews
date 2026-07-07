'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sparkles, Loader2 } from "lucide-react"
import { recordInteraction } from '@/lib/client/interactions'

interface Article {
    id: string
    title: string
    summary: string
    link: string
    published: string
}

export function DeepDiveDialog({ article, trigger }: { article: Article, trigger: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)
    const { messages, append, isLoading, setMessages } = useChat({
        api: '/api/chat',
    })

    const startAnalysis = () => {
        // 深掘りは強い関心シグナルとしてローカルエンジンに学習させる
        recordInteraction(article.id, 'deep_dive')
        setMessages([])
        append({
            role: 'user',
            content: `Title: ${article.title}\nSummary: ${article.summary}\n\nPlease analyze this article.`,
        })
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            setIsOpen(open)
            if (open && messages.length === 0) {
                startAnalysis()
            }
        }}>
            <DialogTrigger asChild>
                {trigger}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] bg-card border-border text-foreground">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold text-primary">
                        <Sparkles className="w-5 h-5 text-primary" />
                        Deep Dive Analysis
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        {article.title}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="h-[400px] mt-4 rounded-md border border-border bg-card p-4">
                    {messages.length === 0 && !isLoading && (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                            <Sparkles className="w-8 h-8 opacity-50" />
                            <p>AI分析を開始します...</p>
                        </div>
                    )}

                    {messages.map((m) => (
                        m.role === 'assistant' && (
                            <div key={m.id} className="space-y-4 animate-in fade-in duration-500">
                                <div className="prose prose-sm max-w-none leading-relaxed text-zinc-700">
                                    {m.content}
                                </div>
                            </div>
                        )
                    ))}

                    {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
                        <div className="flex items-center gap-2 text-primary mt-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-xs">Thinking...</span>
                        </div>
                    )}
                </ScrollArea>

                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="ghost" onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground">
                        閉じる
                    </Button>
                    <Button
                        onClick={startAnalysis}
                        disabled={isLoading}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        再分析
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
