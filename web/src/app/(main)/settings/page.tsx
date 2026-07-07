'use client'

// 設定画面 — 設定可能な項目をここに集約する
//  1. フィードの調整（視野の広さ・ジャンルのON/OFF）
//  2. 関心プロファイル（学習状態・リセット）
//  3. データ同期（記事キャッシュ状態・手動同期）
//  4. 個人Supabase接続（「個人のSupabase = ローカル」モデル）
//  5. データのエクスポート/インポート/全削除

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Database, Download, Upload, Trash2, CheckCircle2, XCircle, Loader2,
    ShieldCheck, SlidersHorizontal, Brain, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
    getPersonalConfig, setPersonalConfig, testPersonalConnection, syncWithPersonalDB,
    pushVectorToPersonalDB,
} from '@/lib/client/personal'
import {
    getAllInteractions, getAllArticles, getKV, setKV, putInteraction, clearAll,
} from '@/lib/client/store'
import { LocalInteraction } from '@/lib/client/types'
import { LocalFilterSlider } from '@/components/local-filter-slider'
import { RSS_CATEGORIES, loadExcluded, saveExcluded } from '@/components/category-filter-bar'

export default function SettingsPage() {
    // 個人DB接続
    const [url, setUrl] = useState('')
    const [key, setKey] = useState('')
    const [connected, setConnected] = useState(false)
    const [testing, setTesting] = useState(false)
    // ローカル状態
    const [interactionCount, setInteractionCount] = useState(0)
    const [hasVector, setHasVector] = useState(false)
    const [strength, setStrength] = useState(0.5)
    const [excluded, setExcluded] = useState<Set<string>>(new Set())
    const [articleCount, setArticleCount] = useState(0)
    const [lastSync, setLastSync] = useState<string>('')
    const [syncing, setSyncing] = useState(false)

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
    }

    useEffect(() => {
        const cfg = getPersonalConfig()
        if (cfg) {
            setUrl(cfg.url)
            setKey(cfg.key)
            setConnected(true)
        }
        setExcluded(loadExcluded())
        reload()
    }, [])

    // ---- フィード調整 ----
    const handleStrengthChange = async (v: number) => {
        setStrength(v)
        await setKV('filter_strength', v)
        const vec = await getKV<number[]>('user_vector')
        if (vec) pushVectorToPersonalDB(vec, v)
    }

    const toggleCategory = (cat: string) => {
        const next = new Set(excluded)
        if (next.has(cat)) next.delete(cat); else next.add(cat)
        setExcluded(next)
        saveExcluded(next)
    }

    // ---- 関心プロファイル ----
    const handleVectorReset = async () => {
        if (!confirm('関心プロファイル（学習済みベクトル）をリセットします。\n次にフィードを開いたとき、ジャンル選択からやり直せます。\n閲覧履歴は削除されません。よろしいですか？')) return
        await setKV('user_vector', null)
        await setKV('vector_updated_at', new Date().toISOString())
        setHasVector(false)
        toast.success('関心プロファイルをリセットしました')
    }

    // ---- データ同期 ----
    const handleManualSync = async () => {
        setSyncing(true)
        try {
            await setKV('pack_last_fetched_ms', 0)  // 間隔制限を解除して強制同期
            const { loadArticles } = await import('@/lib/client/pack')
            await loadArticles()
            await syncWithPersonalDB()
            await reload()
            toast.success('同期が完了しました')
        } catch {
            toast.error('同期に失敗しました（通信環境をご確認ください）')
        } finally {
            setSyncing(false)
        }
    }

    // ---- 個人DB ----
    const handleConnect = async () => {
        if (!url || !key) {
            toast.error('URLとanon keyを入力してください')
            return
        }
        setTesting(true)
        const result = await testPersonalConnection({ url: url.trim(), key: key.trim() })
        setTesting(false)
        if (result.ok) {
            setPersonalConfig({ url: url.trim(), key: key.trim() })
            setConnected(true)
            toast.success('個人DBに接続しました。同期を開始します')
            await syncWithPersonalDB()
        } else {
            toast.error(result.message)
        }
    }

    const handleDisconnect = () => {
        setPersonalConfig(null)
        setConnected(false)
        toast.info('個人DBとの接続を解除しました（ローカルデータは残ります）')
    }

    // ---- エクスポート/インポート/削除 ----
    const handleExport = async () => {
        const [interactions, vector, str] = await Promise.all([
            getAllInteractions(),
            getKV<number[]>('user_vector'),
            getKV<number>('filter_strength'),
        ])
        const data = {
            version: 1,
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
                if (data.vector) {
                    await setKV('user_vector', data.vector)
                    await setKV('vector_updated_at', new Date().toISOString())
                }
                if (typeof data.filter_strength === 'number') {
                    await setKV('filter_strength', data.filter_strength)
                }
                if (Array.isArray(data.excluded_categories)) {
                    const next = new Set<string>(data.excluded_categories)
                    setExcluded(next)
                    saveExcluded(next)
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

    const handleReset = async () => {
        if (!confirm('この端末内の履歴・関心プロファイル・記事キャッシュをすべて削除します。よろしいですか？\n（個人DB側のデータは削除されません）')) return
        await clearAll()
        await reload()
        toast.success('ローカルデータを削除しました')
    }

    const inputClass = "w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/60"

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-3xl mx-auto space-y-5">
                <header>
                    <h1 className="text-xl font-bold tracking-tight">設定</h1>
                    <p className="text-[12px] text-muted-foreground">フィードの調整とデータの管理</p>
                </header>

                {/* プライバシー説明 */}
                <div className="p-3.5 rounded-xl bg-accent border border-primary/20 flex gap-2.5 text-sm">
                    <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <div>
                        <p className="text-[13px] font-medium text-accent-foreground mb-0.5">嗜好データはサーバに送信されません</p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                            閲覧履歴と関心プロファイル（推薦エンジン）はこの端末のブラウザ内に保存されます。
                            端末をまたいで使う場合のみ、下の「個人Supabase接続」を設定してください。
                        </p>
                    </div>
                </div>

                {/* 1. フィードの調整 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <SlidersHorizontal className="w-4 h-4 text-primary" />
                            フィードの調整
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            視野の広さ（バブル外記事の割合）とジャンルの表示/非表示。フィード画面の操作と連動します。
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

                {/* 2. 関心プロファイル */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <Brain className="w-4 h-4 text-primary" />
                            関心プロファイル
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            読んだ記事から学習した、あなたの関心ベクトル。推薦（バブル内）の基準になります。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="text-[13px]">
                            状態: {hasVector
                                ? <span className="text-primary font-medium">学習済み</span>
                                : <span className="text-muted-foreground">未生成（フィードでジャンルを選ぶと作成されます）</span>}
                            <span className="text-muted-foreground text-[11px] ml-2 tnum">閲覧履歴 {interactionCount}件</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleVectorReset} disabled={!hasVector}
                            className="border-border text-muted-foreground hover:text-foreground">
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />学習をやり直す
                        </Button>
                    </CardContent>
                </Card>

                {/* 3. データ同期 */}
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
                            {syncing ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                            今すぐ同期
                        </Button>
                    </CardContent>
                </Card>

                {/* 4. 個人DB接続 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px] flex items-center gap-2">
                            <Database className="w-4 h-4 text-primary" />
                            個人Supabase接続
                            {connected
                                ? <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 ml-1"><CheckCircle2 className="w-3 h-3 mr-1" />接続中</Badge>
                                : <Badge className="bg-secondary text-muted-foreground border-border ml-1"><XCircle className="w-3 h-3 mr-1" />未接続</Badge>}
                        </CardTitle>
                        <CardDescription className="text-[12px]">
                            端末間で履歴と学習を同期したい場合に、あなた自身のSupabaseプロジェクトを接続します
                            （リポジトリの personal_supabase_schema.sql をSQL Editorで実行してから設定）。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-[11px] text-muted-foreground">Project URL</label>
                            <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                                placeholder="https://xxxx.supabase.co" className={inputClass} />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[11px] text-muted-foreground">anon key</label>
                            <input type="password" value={key} onChange={e => setKey(e.target.value)}
                                placeholder="eyJhbGciOi..." className={inputClass} />
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button onClick={handleConnect} disabled={testing} size="sm"
                                className="bg-primary hover:bg-primary/90 text-primary-foreground">
                                {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                接続テスト＆保存
                            </Button>
                            {connected && (
                                <Button variant="outline" size="sm" onClick={handleDisconnect}
                                    className="border-border text-muted-foreground hover:text-foreground">
                                    接続解除
                                </Button>
                            )}
                        </div>
                        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                            接続情報はこの端末のブラウザにのみ保存されます。共用PCでは接続しないでください。
                        </p>
                    </CardContent>
                </Card>

                {/* 5. データ管理 */}
                <Card className="border-border bg-card">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-[15px]">データ管理</CardTitle>
                        <CardDescription className="text-[12px]">
                            履歴 <span className="tnum">{interactionCount}</span> 件 / 関心プロファイル {hasVector ? '学習済み' : '未生成'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={handleExport} className="border-border">
                            <Download className="w-3.5 h-3.5 mr-1.5" />エクスポート
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleImport} className="border-border">
                            <Upload className="w-3.5 h-3.5 mr-1.5" />インポート
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleReset}
                            className="border-red-200 text-red-600 hover:text-red-700 hover:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" />すべて削除
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
