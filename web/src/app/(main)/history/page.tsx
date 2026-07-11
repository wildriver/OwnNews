'use client'

// 閲覧履歴 — 1記事1行の高密度リスト＋ページング（50件/ページ）。
// IndexedDBキャッシュを表示し、運営Supabaseからの同期完了で最新化。

import { Suspense, useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Clock, ExternalLink, Loader2, Sparkles, BookOpen, ChevronLeft, ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import { getAllInteractions } from '@/lib/client/store'
import { LocalInteraction } from '@/lib/client/types'
import { SYNCED_EVENT } from '@/lib/client/sync'

const PAGE_SIZE = 50

function fmtDate(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDwell(sec?: number): string {
    if (!sec || sec < 2) return ''
    if (sec < 60) return `${sec}秒`
    return `${Math.floor(sec / 60)}分${sec % 60 ? `${sec % 60}秒` : ''}`
}

// 閲覧時間から興味の強さを星で表現
function engagementDots(sec?: number): number {
    if (!sec || sec < 5) return 0
    if (sec < 15) return 1
    if (sec < 40) return 2
    if (sec < 120) return 3
    return 4
}

function HistoryRow({ item }: { item: LocalInteraction }) {
    const dwell = fmtDwell(item.dwell_seconds)
    const dots = engagementDots(item.dwell_seconds)
    return (
        <div className="group flex items-center gap-3 px-3 py-2 hover:bg-secondary/60 transition-colors">
            <div className="flex-1 min-w-0">
                <Link
                    href={`/article/${item.article_id}`}
                    className="block text-[13px] font-medium leading-snug truncate group-hover:text-primary transition-colors"
                >
                    {item.title || '（タイトル不明）'}
                </Link>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 min-w-0">
                    <span className="shrink-0 tnum flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />{fmtDate(item.created_at)}
                    </span>
                    {item.category && (
                        <span className="shrink-0 truncate">{item.category.split(',')[0]}</span>
                    )}
                    {item.type === 'deep_dive' && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-indigo-600">
                            <Sparkles className="w-2.5 h-2.5" />深掘り
                        </span>
                    )}
                    {dwell && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-primary/80">
                            <BookOpen className="w-2.5 h-2.5" />{dwell}
                        </span>
                    )}
                    {dots > 0 && (
                        <span className="shrink-0 text-primary tracking-[-1px]" title={`興味の強さ ${dots}/4`}>
                            {'●'.repeat(dots)}<span className="text-border">{'●'.repeat(4 - dots)}</span>
                        </span>
                    )}
                </div>
            </div>
            {item.link && (
                <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            )}
        </div>
    )
}

// interaction がフィルタ条件に一致するか判定する。
// category_medium が完全一致すればOK、なければ category 文字列への部分一致も許容する（寛容な判定）。
function matchesFilter(item: LocalInteraction, cat: string | null, kw: string | null): boolean {
    if (cat) {
        const mediumMatch = item.category_medium === cat
        const looseMatch = (item.category || '').includes(cat)
        if (!mediumMatch && !looseMatch) return false
    }
    if (kw) {
        if (!(item.title || '').includes(kw)) return false
    }
    return true
}

// 適用中のフィルタを示すチップ。×クリックでクエリを除去して /history へ戻る。
function FilterChip({ cat, kw, onClear }: { cat: string | null; kw: string | null; onClear: () => void }) {
    if (!cat && !kw) return null
    const label = [cat, kw].filter(Boolean).join(' ・ ')
    return (
        <div className="flex items-center">
            <button
                onClick={onClear}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent text-primary text-[12px] font-medium hover:bg-accent/70 transition-colors"
            >
                フィルタ: {label}
                <X className="w-3 h-3" />
            </button>
        </div>
    )
}

function PaginatedList({ items }: { items: LocalInteraction[] }) {
    const [page, setPage] = useState(0)
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
    // items が変わったら1ページ目へ
    useEffect(() => { setPage(0) }, [items])
    const p = Math.min(page, pages - 1)
    const slice = useMemo(() => items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE), [items, p])

    if (items.length === 0) {
        return <div className="text-center py-12 text-sm text-muted-foreground">履歴はありません</div>
    }

    return (
        <div>
            <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
                {slice.map(item => (
                    <HistoryRow key={`${item.article_id}-${item.type}`} item={item} />
                ))}
            </div>
            {pages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4 text-[12px]">
                    <button
                        onClick={() => setPage(p - 1)}
                        disabled={p === 0}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-default"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />前へ
                    </button>
                    <span className="tnum text-muted-foreground">
                        {p * PAGE_SIZE + 1}–{Math.min((p + 1) * PAGE_SIZE, items.length)} / {items.length}件
                    </span>
                    <button
                        onClick={() => setPage(p + 1)}
                        disabled={p >= pages - 1}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-default"
                    >
                        次へ<ChevronRight className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}
        </div>
    )
}

function HistoryPageInner() {
    const [interactions, setInteractions] = useState<LocalInteraction[] | null>(null)
    const router = useRouter()
    const searchParams = useSearchParams()
    const cat = searchParams.get('cat')
    const kw = searchParams.get('kw')

    useEffect(() => {
        const load = () => getAllInteractions().then(ints =>
            setInteractions(ints.sort((a, b) => b.created_at.localeCompare(a.created_at)))
        )
        load()
        window.addEventListener(SYNCED_EVENT, load)
        return () => window.removeEventListener(SYNCED_EVENT, load)
    }, [])

    if (!interactions) {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        )
    }

    // タイトル未取得（Phase1以前の古い履歴）は表示しない。実データはSQL整理＋同期で削除される。
    const withTitle = interactions.filter(i => (i.title || '').trim() !== '')
    // ダッシュボードのチャートからの遷移用に、カテゴリ・キーワードでの絞り込みを全タブへ適用する。
    const filtered = withTitle.filter(i => matchesFilter(i, cat, kw))
    const viewed = filtered.filter(i => i.type === 'view' || i.type === 'deep_dive')
    const stocked = filtered.filter(i => i.type === 'bookmark')
    const excluded = filtered.filter(i => i.type === 'not_interested')

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-4">
                <header>
                    <h1 className="text-xl font-bold tracking-tight">履歴</h1>
                    <p className="text-[12px] text-muted-foreground">
                        閲覧履歴と非表示設定（アカウントに同期）。●は閲覧時間から推定した興味の強さです。
                    </p>
                </header>

                <FilterChip cat={cat} kw={kw} onClear={() => router.push('/history')} />

                <Tabs defaultValue="viewed" className="w-full">
                    <TabsList className="grid w-full grid-cols-3 bg-card p-1 mb-4">
                        <TabsTrigger value="viewed" className="data-[state=active]:bg-accent data-[state=active]:text-primary">
                            閲覧履歴（{viewed.length}）
                        </TabsTrigger>
                        <TabsTrigger value="stocked" className="data-[state=active]:bg-accent data-[state=active]:text-primary">
                            ストック（{stocked.length}）
                        </TabsTrigger>
                        <TabsTrigger value="excluded" className="data-[state=active]:bg-red-50 data-[state=active]:text-red-600">
                            非表示リスト（{excluded.length}）
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="viewed">
                        <PaginatedList items={viewed} />
                    </TabsContent>
                    <TabsContent value="stocked">
                        <PaginatedList items={stocked} />
                    </TabsContent>
                    <TabsContent value="excluded">
                        <PaginatedList items={excluded} />
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    )
}

export default function HistoryPage() {
    // useSearchParams は Suspense 境界が必要なためラップする。
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        }>
            <HistoryPageInner />
        </Suspense>
    )
}
