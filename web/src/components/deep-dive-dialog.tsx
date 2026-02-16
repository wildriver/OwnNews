'use client'

import { useState } from 'react'
import { useChat } from 'ai/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sparkles, Loader2 } from "lucide-react"

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
            <DialogContent className="sm:max-w-[600px] bg-[#0F172A] border-white/10 text-slate-200">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                        <Sparkles className="w-5 h-5 text-sky-400" />
                        Deep Dive Analysis
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                        {article.title}
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="h-[400px] mt-4 rounded-md border border-white/5 bg-white/5 p-4">
                    {messages.length === 0 && !isLoading && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                            <Sparkles className="w-8 h-8 opacity-50" />
                            <p>AI分析を開始します...</p>
                        </div>
                    )}

                    {messages.map((m) => (
                        m.role === 'assistant' && (
                            <div key={m.id} className="space-y-4 animate-in fade-in duration-500">
                                <div className="prose prose-invert prose-sm max-w-none leading-relaxed text-slate-300">
                                    {m.content}
                                </div>
                            </div>
                        )
                    ))}

                    {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
                        <div className="flex items-center gap-2 text-sky-400 mt-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-xs">Thinking...</span>
                        </div>
                    )}
                </ScrollArea>

                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="ghost" onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-200">
                        閉じる
                    </Button>
                    <Button
                        onClick={startAnalysis}
                        disabled={isLoading}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                        再分析
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
