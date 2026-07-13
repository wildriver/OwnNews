'use client'

// 「もっと知る」パネル — 人に聞くか、AIに聞くか。
// 以前は「AIで深掘り」（左カラム・藍色カード）と「みんなの反応」（右カラム・白カード）に
// 分かれていたが、同じ「この記事についてもっと知る」ジャンルの機能なので1枚に統合した。
//   - AIに聞く: ChatGPT/Claude/Perplexityへ質問文を引き継ぐ（無料・API不要・本文転載なし）
//   - 人の反応: Xでの議論・投稿（モバイルはアプリ優先）＋はてなブックマークのコメント
// AIボタンは「深掘り」として関心学習に反映される（学習率は従来どおり）。

import { useState, useEffect } from 'react'
import { Sparkles, MessageCircle, Copy, Check, ExternalLink, PenLine } from 'lucide-react'
import { recordInteraction } from '@/lib/client/interactions'

// ---- 共通のボタンスタイル（AI・人で見た目を揃える） ----
const BTN =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 text-[13px] font-medium hover:bg-secondary hover:text-foreground transition-colors cursor-pointer'

// ---- AIに聞く ----
function buildPrompt(title: string, link: string): string {
    return `以下のニュース記事について、記事に書かれていない背景・歴史的文脈・多様な視点・今後の見通しを日本語で解説してください。\n\nタイトル: ${title}\n記事URL: ${link}`
}

const AI_SERVICES = [
    { name: 'ChatGPT', url: (q: string) => `https://chatgpt.com/?q=${q}` },
    { name: 'Claude', url: (q: string) => `https://claude.ai/new?q=${q}` },
    { name: 'Perplexity', url: (q: string) => `https://www.perplexity.ai/search?q=${q}` },
]

// ---- 人の反応（X） ----
// スマホのブラウザでWeb版Xを開くとログインを求められがちなので、
// twitter:// スキームでアプリを直接開く。開かなければWeb版へフォールバック。
function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1)
}

function openInXApp(appUrl: string, webUrl: string): void {
    let done = false
    const timer = setTimeout(() => {
        if (!done && !document.hidden) {
            done = true
            window.location.href = webUrl
        }
    }, 1800)
    const onHide = () => {
        done = true
        clearTimeout(timer)
        document.removeEventListener('visibilitychange', onHide)
    }
    document.addEventListener('visibilitychange', onHide)
    window.location.href = appUrl
}

// Xのロゴ（lucideに現行ロゴが無いためインラインSVG）
function XLogo({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
    )
}

// ---- はてなブックマーク ----
interface HatenaComment {
    user: string
    comment: string
    timestamp: string
}

interface HatenaData {
    count: number
    entry_url: string | null
    comments: HatenaComment[]
}

function fmtHatenaDate(ts: string): string {
    const m = ts.match(/^\d{4}\/(\d{2})\/(\d{2})/)
    return m ? `${Number(m[1])}/${Number(m[2])}` : ''
}

export function KnowMorePanel({ articleId, title, link }: { articleId: string; title: string; link: string }) {
    const [copied, setCopied] = useState(false)
    const [hatena, setHatena] = useState<HatenaData | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/hatena?url=${encodeURIComponent(link)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d) setHatena(d) })
            .catch(() => { })
        return () => { cancelled = true }
    }, [link])

    const prompt = buildPrompt(title, link)
    const q = encodeURIComponent(prompt)
    const markDeepDive = () => { recordInteraction(articleId, 'deep_dive') }
    // Xで検索/投稿・はてブ「すべて見る」を開いた記録（学習には使わない）。
    // はてブコメントのインライン表示は記事を開くだけで出るため記録しない
    // （自動表示を「利用」として数えると指標が閲覧数と同じになってしまう）。
    const markKnowX = () => { recordInteraction(articleId, 'know_x') }
    const markKnowHatena = () => { recordInteraction(articleId, 'know_hatena') }

    const onCopy = async () => {
        markDeepDive()
        try {
            await navigator.clipboard.writeText(prompt)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch { /* クリップボード不可の環境では何もしない */ }
    }

    // 検索は記事URLで行う（シェア投稿は必ずURLを含むため、タイトル検索より確実）
    const xSearchUrl = `https://x.com/search?q=${encodeURIComponent(link)}&f=live`
    const xPostUrl = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(link)}`
    const xSearchApp = `twitter://search?query=${encodeURIComponent(link)}`
    const xPostApp = `twitter://post?message=${encodeURIComponent(`${title}\n${link}`)}`

    const onXClick = (appUrl: string) => (e: React.MouseEvent) => {
        markKnowX()
        if (!isMobileDevice()) return
        e.preventDefault()
        openInXApp(appUrl, (e.currentTarget as HTMLAnchorElement).href)
    }

    return (
        <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-xl font-bold text-foreground mb-1">もっと知る</h2>
            <p className="text-[12px] text-muted-foreground mb-4">
                この記事について — 人に聞くか、AIに聞くか
            </p>

            {/* AIに聞く */}
            <div className="flex items-center gap-1.5 mb-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                <span className="text-[13px] font-semibold">AIに聞く</span>
                <span className="text-[10px] text-muted-foreground ml-1">質問文を自動で引き継ぎます</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {AI_SERVICES.map(svc => (
                    <a
                        key={svc.name}
                        href={svc.url(q)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={markDeepDive}
                        className={BTN}
                    >
                        {svc.name}
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                ))}
                <button onClick={onCopy} className={BTN}>
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                    {copied ? 'コピー済み' : '質問をコピー'}
                </button>
            </div>

            {/* 人の反応 */}
            <div className="mt-5 pt-4 border-t border-border">
                <div className="flex items-center gap-1.5 mb-2">
                    <MessageCircle className="w-4 h-4 text-primary" />
                    <span className="text-[13px] font-semibold">人の反応</span>
                    <span className="text-[10px] text-muted-foreground ml-1">SNSでの受け止めを見る・発信する</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <a
                        href={xSearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onXClick(xSearchApp)}
                        className={BTN}
                    >
                        <XLogo className="w-3.5 h-3.5" />
                        議論を見る
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                    <a
                        href={xPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onXClick(xPostApp)}
                        className={BTN}
                    >
                        <PenLine className="w-3.5 h-3.5" />
                        投稿する
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
                </div>

                {/* はてなブックマークのコメント（アプリ内表示） */}
                <div className="mt-4">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#00A4DE] text-white text-[10px] font-bold shrink-0">B!</span>
                        <span className="text-[12px] font-semibold">はてなブックマーク</span>
                        {hatena && hatena.count > 0 && (
                            <span className="text-[11px] text-muted-foreground tnum">{hatena.count} users</span>
                        )}
                        {hatena?.entry_url && (
                            <a
                                href={hatena.entry_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={markKnowHatena}
                                className="ml-auto text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
                            >
                                すべて見る<ExternalLink className="w-3 h-3" />
                            </a>
                        )}
                    </div>

                    {hatena === null ? (
                        <p className="text-[12px] text-muted-foreground">読み込み中…</p>
                    ) : hatena.comments.length === 0 ? (
                        <p className="text-[12px] text-muted-foreground">
                            {hatena.count > 0
                                ? `${hatena.count}件ブックマークされています（コメントはまだありません）`
                                : 'まだブックマークコメントはありません'}
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {hatena.comments.map((c, idx) => (
                                <li key={`${c.user}-${idx}`} className="text-[13px] leading-relaxed">
                                    <span className="text-zinc-700">{c.comment}</span>
                                    <span className="ml-2 text-[11px] text-muted-foreground whitespace-nowrap">
                                        — {c.user} {fmtHatenaDate(c.timestamp)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    )
}
