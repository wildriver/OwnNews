'use client'

// 「AIで深掘り」パネル（外部AI引き継ぎ方式）。
// 以前はGroqの70Bでアプリ内解説を生成していたが、品質が不十分だったため、
// ユーザー自身が使っているAI（ChatGPT/Claude/Perplexity）へプロンプトを
// 引き継ぐ方式に変更。無料・API不要で、各自のアカウントの最高品質モデルが使える。
// 渡すのは記事タイトルとURLのみ（本文の転載はしない=著作権的にもクリーン）。
// ボタン押下は「深掘り」として関心学習に反映される（学習率は従来どおり）。

import { useState } from 'react'
import { Sparkles, Copy, Check, ExternalLink } from 'lucide-react'
import { recordInteraction } from '@/lib/client/interactions'

function buildPrompt(title: string, link: string): string {
    return `以下のニュース記事について、記事に書かれていない背景・歴史的文脈・多様な視点・今後の見通しを日本語で解説してください。\n\nタイトル: ${title}\n記事URL: ${link}`
}

const AI_SERVICES = [
    { name: 'ChatGPT', url: (q: string) => `https://chatgpt.com/?q=${q}` },
    { name: 'Claude', url: (q: string) => `https://claude.ai/new?q=${q}` },
    { name: 'Perplexity', url: (q: string) => `https://www.perplexity.ai/search?q=${q}` },
]

export function ExternalAiPanel({ articleId, title, link }: { articleId: string; title: string; link: string }) {
    const [copied, setCopied] = useState(false)
    const prompt = buildPrompt(title, link)
    const q = encodeURIComponent(prompt)

    // どの方式でも「深掘り」として学習（興味の強いシグナル）
    const markDeepDive = () => { recordInteraction(articleId, 'deep_dive') }

    const onCopy = async () => {
        markDeepDive()
        try {
            await navigator.clipboard.writeText(prompt)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch { /* クリップボード不可の環境では何もしない */ }
    }

    return (
        <div className="bg-indigo-50/60 border border-indigo-200/70 rounded-xl p-6">
            <h2 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" /> AIで深掘り
            </h2>
            <p className="text-[12px] text-muted-foreground mb-4">
                お使いのAIに、この記事の背景・文脈の解説を依頼します（質問文を自動で引き継ぎます）
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {AI_SERVICES.map(svc => (
                    <a
                        key={svc.name}
                        href={svc.url(q)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={markDeepDive}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2.5 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors cursor-pointer"
                    >
                        {svc.name}
                        <ExternalLink className="w-3 h-3 text-indigo-400" />
                    </a>
                ))}
                <button
                    onClick={onCopy}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2.5 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 transition-colors cursor-pointer"
                >
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5 text-indigo-400" />}
                    {copied ? 'コピー済み' : '質問をコピー'}
                </button>
            </div>
        </div>
    )
}
