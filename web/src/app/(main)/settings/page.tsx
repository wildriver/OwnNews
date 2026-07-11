'use client'

// 設定画面 — 設定可能な項目をここに集約する
//  1. アカウント・クラウド同期（Googleログイン状態。推薦データは運営Supabaseに保存）
//  2. フィードの調整（視野の広さ・ジャンルのON/OFF）※運営Supabaseへ同期
//  3. 関心プロファイル（学習状態・エクスポート/インポート/リセット）
//  4. 記事データの同期（記事キャッシュ状態・手動同期）

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
    Download, Upload, ShieldCheck, SlidersHorizontal, Brain, RefreshCw, Cloud, LogOut, Bell,
} from 'lucide-react'
import { toast } from 'sonner'
import {
    getAllInteractions, getAllArticles, getKV, setKV, putInteraction,
} from '@/lib/client/store'
import { LocalInteraction } from '@/lib/client/types'
import { getUserEmail, pushSettings, pushVector, deleteRemoteVector, SYNCED_EVENT } from '@/lib/client/sync'
import { getSubscriptionState, subscribePush, unsubscribePush } from '@/lib/client/push'
import { LocalFilterSlider } from '@/components/local-filter-slider'
import { RSS_CATEGORIES, loadExcluded, saveExcluded } from '@/components/category-filter-bar'

export default function SettingsPage() {
    const [email, setEmail] = useState<string>('')
    const [interactionCount, setInteractionCount] = useState(0)
    const [hasVector, setHasVector] = useState(false)
    const [strength, setStrength] = useState(0.5)
    const [excluded, setExcluded] = useState<Set<string>>(new Set())
    const [articleCount, setArticleCount] = useState(0)
    const [lastSync, setLastSync] = useState<string>('')
    const [syncing, setSyncing] = useState(false)
    const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'>('unsupported')
    const [pushBusy, setPushBusy] = useState(false)

    const reload = async () => {
        const [ints, arts, vec, str, syncMs] = await Promise.all([
            getAllInteractions(),
            getAllArticles(),
            getKV<number[]>('user_vector'),
            getKV<number>('filter_strength'),
            getKV<number>('pack_last_fetched_ms'),
        ])
        setInteractionCount(ints.length)
        setArticleCount(arts.length)
        setHasVector(!!vec)
        setStrength(str ?? 0.5)
        setLastSync(syncMs ? new Date(syncMs).toLocaleString('ja-JP') : '未同期')
        setExcluded(loadExcluded())
    }

    useEffect(() => {
        getUserEmail().then(e => setEmail(e ?? ''))
        reload()
        getSubscriptionState().then(setPushState)
        window.addEventListener(SYNCED_EVENT, reload)
        return () => window.removeEventListener(SYNCED_EVENT, reload)
    }, [])

    // ---- 通知 ----
    const handlePushToggle = async () => {
        setPushBusy(true)
        try {
            if (pushState === 'subscribed') {
                const r = await unsubscribePush()
                if (r.ok) toast.info(r.message); else toast.error(r.message)
            } else {
                const r = await subscribePush()
                if (r.ok) toast.success(r.message); else toast.error(r.message)
            }
            setPushState(await getSubscriptionState())
        } finally {
            setPushBusy(false)
        }
    }

    // ---- フィード調整（運営Supabaseへ同期） ----
    const handleStrengthChange = async (v: number) => {
        setStrength(v)
        await setKV('filter_strength', v)
        pushSettings({ filterStrength: v }).then(ok => {
            if (!ok) toast.error('サーバーへの保存に失敗しました（この端末には保存済み）')
        })
    }

    const toggleCategory = (cat: string) => {
        const next = new Set(excluded)
        if (next.has(cat)) next.delete(cat); else next.add(cat)
        setExcluded(next)
        saveExcluded(next)
        pushSettings({ excludedCategories: Array.from(next) }).then(ok => {
            if (!ok) toast.error('サーバーへの保存に失敗しました（この端末には保存済み）')
        })
    }

    // ---- 関心プロファイル ----
    const handleVectorReset = async () => {
        if (!confirm('関心プロファイル（学習済みベクトル）をリセットします。\n次にフィードを開いたとき、ジャンル選択からやり直せます。\n閲覧履歴は削除されません。よろしいですか？')) return
        await setKV('user_vector', null)
        await setKV('vector_updated_at', new Date().toISOString())
        // サーバー側の保管庫からも削除（残すと次の同期で古いベクトルが復活してしまう）
        const ok = await deleteRemoteVector()
        setHasVector(false)
        if (ok) toast.success('関心プロファイルをリセットしました（全端末に反映されます）')
        else toast.warning('この端末ではリセットしましたが、サーバーへの反映に失敗しました。通信環境の良いところで再度お試しください')
    }

    // ---- 記事データの同期 ----
    const handleManualSync = async () => {
        setSyncing(true)
        try {
            await setKV('pack_last_fetched_ms', 0)
            const { loadArticles } = await import('@/lib/client/pack')
            await loadArticles()
            await reload()
            toast.success('記事データを同期しました')
        } catch {
            toast.error('同期に失敗しました（通信環境をご確認ください）')
        } finally {
            setSyncing(false)
        }
    }

    // ---- エクスポート/インポート ----
    const handleExport = async () => {
        const [interactions, vector, str] = await Promise.all([
            getAllInteractions(),
            getKV<number[]>('user_vector'),
            getKV<number>('filter_strength'),
        ])
        const data = {
            version: 2,
            exported_at: new Date().toISOString(),
            vector: vector || null,
            filter_strength: str ?? 0.5,
            excluded_categories: Array.from(loadExcluded()),
            interactions,
        }
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `ownnews-profile-${new Date().toISOString().split('T')[0]}.json`
        a.click()
        URL.revokeObjectURL(a.href)
        toast.success('プロファイルを書き出しました')
    }

    const handleImport = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json'
        input.onchange = async () => {
            const file = input.files?.[0]
            if (!file) return
            try {
                const data = JSON.parse(await file.text())
                const parts = [
                    data.vector ? '関心ベクトル' : null,
                    typeof data.filter_strength === 'number' ? '視野の広さ' : null,
                    Array.isArray(data.excluded_categories) ? 'ジャンル設定' : null,
                    Array.isArray(data.interactions) ? `閲覧履歴 ${data.interactions.length}件` : null,
                ].filter(Boolean).join('・')
                if (!parts) { toast.error('このファイルにはプロファイルデータが含まれていません'); return }
                if (!confirm(`ファイルの内容（${parts}）で現在のプロファイルを上書きします。よろしいですか？`)) return
                if (data.vector) {
                    await setKV('user_vector', data.vector)
                    await setKV('vector_updated_at', new Date().toISOString())
                    pushVector(data.vector, new Date().toISOString())
                }
                if (typeof data.filter_strength === 'number') {
                    await setKV('filter_strength', data.filter_strength)
                    pushSettings({ filterStrength: data.filter_strength })
                }
                if (Array.isArray(data.excluded_categories)) {
                    const next = new Set<string>(data.excluded_categories)
                    saveExcluded(next)
                    pushSettings({ excludedCategories: data.excluded_categories })
                }
                if (Array.isArray(data.interactions)) {
                    for (const i of data.interactions as LocalInteraction[]) {
                        await putInteraction({ ...i, synced: false })
                    }
                }
                toast.success('プロファイルを読み込みました')
                await reload()
            } catch {
                toast.error('ファイルの読み込みに失敗しました')
            }
        }
        input.click()
    }

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-3xl mx-auto space-y-5">
                <header>
                    <h1 className="text-xl font-bold tracking-tight">設定</h1>
                    <p className="text-[12px] text-muted-foreground">フィードの調整とデータの管理</p>
                </header>

                {/* 1. アカウント・クラウド同期 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <Cloud className="w-4 h-4 text-primary" />
                            アカウント・クラウド同期
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            推薦データ（関心プロファイル・フィルタ強度・ジャンル設定・閲覧履歴）は、
                            このGoogleアカウントに紐づけて安全に保存され、パソコンとスマホで自動同期されます。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
                                {(email || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                                <div className="text-[13px] font-medium">{email ? email.split('@')[0] : '未ログイン'}</div>
                                <div className="text-[11px] text-muted-foreground truncate">{email}</div>
                            </div>
                        </div>
                        <form action="/auth/signout" method="post">
                            <Button type="submit" variant="outline" size="sm" className="border-border text-muted-foreground hover:text-foreground">
                                <LogOut className="w-3.5 h-3.5 mr-1.5" />ログアウト
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {/* プライバシー説明 */}
                <div className="p-3.5 rounded-xl bg-accent border border-primary/20 flex gap-2.5 text-sm">
                    <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                        ニュースの推薦計算はすべてこの端末の中で行われます。運営サーバーはあなたの推薦データを保存しますが、
                        推薦アルゴリズムをサーバー側で実行することはありません。データは他のユーザーからは見えません。
                    </p>
                </div>

                {/* 通知 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <Bell className="w-4 h-4 text-primary" />
                            毎日のニュース通知
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            新しいニュースが届いたら、毎朝1回プッシュ通知でお知らせします。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="text-[13px]">
                                状態: {
                                    pushState === 'subscribed' ? <span className="text-primary font-medium">オン</span>
                                        : pushState === 'denied' ? <span className="text-rose-600">ブラウザでブロック中</span>
                                            : pushState === 'unsupported' ? <span className="text-muted-foreground">この端末では非対応</span>
                                                : <span className="text-muted-foreground">オフ</span>
                                }
                            </div>
                            <Button
                                size="sm"
                                onClick={handlePushToggle}
                                disabled={pushBusy || pushState === 'unsupported' || pushState === 'denied'}
                                className={pushState === 'subscribed'
                                    ? 'bg-secondary text-foreground hover:bg-secondary/80 border border-border'
                                    : 'bg-primary hover:bg-primary/90 text-primary-foreground'}
                            >
                                {pushBusy ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Bell className="w-3.5 h-3.5 mr-1.5" />}
                                {pushState === 'subscribed' ? '通知をオフにする' : '通知をオンにする'}
                            </Button>
                        </div>
                        {pushState === 'denied' && (
                            <p className="text-[11px] text-muted-foreground leading-relaxed">
                                ブラウザの設定でこのサイトの通知がブロックされています。サイト設定から許可に変更してください。
                            </p>
                        )}
                        <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                            ※ iPhoneのSafariでは、先に「ホーム画面に追加」してから開くと通知を受け取れます。
                        </p>
                    </CardContent>
                </Card>

                {/* 2. フィードの調整 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-primary" />
                            フィードの調整
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            視野の広さ（バブル外記事の割合）とジャンルの表示/非表示。フィード画面の操作と連動し、端末間で同期されます。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <LocalFilterSlider value={strength} onChange={handleStrengthChange} />
                        <div>
                            <div className="text-[11px] text-muted-foreground mb-1.5">表示するジャンル（タップでON/OFF）</div>
                            <div className="flex flex-wrap gap-1.5">
                                {RSS_CATEGORIES.map(cat => {
                                    const isOff = excluded.has(cat)
                                    return (
                                        <button
                                            key={cat}
                                            onClick={() => toggleCategory(cat)}
                                            className={`h-7 px-2.5 text-[11px] font-medium rounded-full border transition-colors ${isOff
                                                ? 'text-muted-foreground/60 bg-transparent border-border line-through'
                                                : 'text-accent-foreground bg-accent border-transparent hover:opacity-80'
                                                }`}
                                        >
                                            {cat}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* 3. 関心プロファイル（持ち出し・復元・作り直し） */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <Brain className="w-4 h-4 text-primary" />
                            関心プロファイル
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            読んだ記事から学習した、あなたの関心ベクトル。推薦（バブル内）の基準になります。
                            あなたに帰属するデータなので、ファイルとして持ち出し・復元・作り直しができます。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="text-[13px]">
                            状態: {hasVector
                                ? <span className="text-primary font-medium">学習済み</span>
                                : <span className="text-muted-foreground">未生成（フィードでジャンルを選ぶと作成されます）</span>}
                            <span className="text-muted-foreground text-[11px] ml-2 tnum">閲覧履歴 {interactionCount}件</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={handleExport} className="border-border">
                                <Download className="w-3.5 h-3.5 mr-1.5" />エクスポート
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleImport} className="border-border">
                                <Upload className="w-3.5 h-3.5 mr-1.5" />インポート
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleVectorReset} disabled={!hasVector}
                                className="border-border text-muted-foreground hover:text-foreground">
                                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />学習をやり直す
                            </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            エクスポート＝関心ベクトル・視野の広さ・ジャンル設定・閲覧履歴をJSONファイルに保存。
                            インポート＝そのファイルから復元（上書き前に確認します）。
                        </p>
                    </CardContent>
                </Card>

                {/* 4. 記事データの同期 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <RefreshCw className="w-4 h-4 text-primary" />
                            記事データの同期
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-[12px] text-muted-foreground">
                            <span className="tnum">記事キャッシュ {articleCount}件</span>
                            <span className="mx-2">·</span>
                            最終同期 <span className="tnum">{lastSync}</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleManualSync} disabled={syncing}
                            className="border-border">
                            {syncing ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                            今すぐ同期
                        </Button>
                    </CardContent>
                </Card>

            </div>
        </div>
    )
}
