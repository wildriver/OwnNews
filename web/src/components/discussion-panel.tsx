'use client'

// 記事詳細の「みんなの反応」パネル。
// - X: 従量制APIを使わず、検索への深いリンク（議論を見る）と
//      Web Intent（投稿の下書きを開く）で連携する。どちらも無料・規約準拠。
// - はてなブックマーク: 無料APIで件数とコメントをアプリ内表示（/api/hatena経由）。

import { useState, useEffect } from 'react'
import { MessageCircle, ExternalLink, PenLine } from 'lucide-react'

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

// ---- モバイルではXアプリを優先して開く ----
// スマホのブラウザでWeb版Xを開くとログインを求められがちなので、
// twitter:// スキームでアプリの画面を直接開く。アプリ未インストール時は
// 一定時間たってもページが隠れない（=アプリに切り替わらなかった）ことを
// 検知して従来のWeb版URLへフォールバックする。
function isMobileDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    // iPadOSはMac風UAを名乗るためタッチ点数でも判定
    return /Android|iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(ua) && navigator.maxTouchPoints > 1)
}

function openInXApp(appUrl: string, webUrl: string): void {
    let done = false
    const timer = setTimeout(() => {
        if (!done && !document.hidden) {
            done = true
            window.location.href = webUrl  // アプリが開かなかった → Web版へ
        }
    }, 1800)
    const onHide = () => {
        // アプリに切り替わった（ページが隠れた）のでフォールバック不要
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

function fmtHatenaDate(ts: string): string {
    // "2026/07/09 12:34" → "7/9"
    const m = ts.match(/^\d{4}\/(\d{2})\/(\d{2})/)
    return m ? `${Number(m[1])}/${Number(m[2])}` : ''
}

export function DiscussionPanel({ title, link }: { title: string; link: string }) {
    const [hatena, setHatena] = useState<HatenaData | null>(null)

    useEffect(() => {
        let cancelled = false
        fetch(`/api/hatena?url=${encodeURIComponent(link)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d) setHatena(d) })
            .catch(() => { })
        return () => { cancelled = true }
    }, [link])

    // 検索は記事URLで行う（シェア投稿は必ずURLを含むため、タイトル検索より確実）
    const xSearchUrl = `https://x.com/search?q=${encodeURIComponent(link)}&f=live`
    const xPostUrl = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(link)}`
    // Xアプリのディープリンク（モバイル用）
    const xSearchApp = `twitter://search?query=${encodeURIComponent(link)}`
    const xPostApp = `twitter://post?message=${encodeURIComponent(`${title}\n${link}`)}`

    // モバイルではアプリを試し、ダメならWeb版へ。PCは通常のリンク挙動のまま
    const onXClick = (appUrl: string) => (e: React.MouseEvent) => {
        if (!isMobileDevice()) return
        e.preventDefault()
        openInXApp(appUrl, (e.currentTarget as HTMLAnchorElement).href)
    }

    return (
        <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="text-xl font-bold text-foreground mb-1 flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-primary" /> みんなの反応
            </h2>
            <p className="text-[12px] text-muted-foreground mb-4">
                この記事がSNSでどう受け止められているかを見る・自分の意見を発信する
            </p>

            {/* X連携（外部リンク） */}
            <div className="flex flex-col sm:flex-row gap-2">
                <a
                    href={xSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onXClick(xSearchApp)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-[13px] font-medium hover:bg-secondary transition-colors"
                >
                    <XLogo className="w-4 h-4" />
                    Xでの議論を見る
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
                <a
                    href={xPostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onXClick(xPostApp)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-[13px] font-medium hover:bg-secondary transition-colors"
                >
                    <PenLine className="w-4 h-4" />
                    Xに投稿する
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                </a>
            </div>

            {/* はてなブックマークのコメント（アプリ内表示） */}
            <div className="mt-5 pt-4 border-t border-border">
                <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#00A4DE] text-white text-[10px] font-bold shrink-0">B!</span>
                    <span className="text-[13px] font-semibold">はてなブックマーク</span>
                    {hatena && hatena.count > 0 && (
                        <span className="text-[12px] text-muted-foreground tnum">{hatena.count} users</span>
                    )}
                    {hatena?.entry_url && (
                        <a
                            href={hatena.entry_url}
                            target="_blank"
                            rel="noopener noreferrer"
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
                    <ul className="space-y-2.5">
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
    )
}
