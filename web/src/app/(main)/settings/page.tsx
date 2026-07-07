'use client'

// 設定画面: 個人Supabase接続・ローカルデータのエクスポート/インポート/リセット
// 「個人のSupabase = ローカル」モデルの管理画面。

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Database, Download, Upload, Trash2, CheckCircle2, XCircle, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import {
    getPersonalConfig, setPersonalConfig, testPersonalConnection, syncWithPersonalDB,
} from '@/lib/client/personal'
import {
    getAllInteractions, getKV, setKV, putInteraction, clearAll,
} from '@/lib/client/store'
import { LocalInteraction } from '@/lib/client/types'

export default function SettingsPage() {
    const [url, setUrl] = useState('')
    const [key, setKey] = useState('')
    const [connected, setConnected] = useState(false)
    const [testing, setTesting] = useState(false)
    const [interactionCount, setInteractionCount] = useState(0)
    const [hasVector, setHasVector] = useState(false)

    useEffect(() => {
        const cfg = getPersonalConfig()
        if (cfg) {
            setUrl(cfg.url)
            setKey(cfg.key)
            setConnected(true)
        }
        getAllInteractions().then(ints => setInteractionCount(ints.length))
        getKV<number[]>('user_vector').then(v => setHasVector(!!v))
    }, [])

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

    const handleExport = async () => {
        const [interactions, vector, strength] = await Promise.all([
            getAllInteractions(),
            getKV<number[]>('user_vector'),
            getKV<number>('filter_strength'),
        ])
        const data = {
            version: 1,
            exported_at: new Date().toISOString(),
            vector: vector || null,
            filter_strength: strength ?? 0.5,
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
                if (Array.isArray(data.interactions)) {
                    for (const i of data.interactions as LocalInteraction[]) {
                        await putInteraction({ ...i, synced: false })
                    }
                }
                toast.success('プロファイルを読み込みました')
                setHasVector(!!data.vector)
                setInteractionCount((data.interactions || []).length)
            } catch {
                toast.error('ファイルの読み込みに失敗しました')
            }
        }
        input.click()
    }

    const handleReset = async () => {
        if (!confirm('この端末内の履歴・関心ベクトル・記事キャッシュをすべて削除します。よろしいですか？\n（個人DB側のデータは削除されません）')) return
        await clearAll()
        setInteractionCount(0)
        setHasVector(false)
        toast.success('ローカルデータを削除しました')
    }

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-3xl mx-auto space-y-8">
                <header>
                    <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-indigo-400">
                        Settings
                    </h1>
                    <p className="text-slate-400">データの保存先と管理</p>
                </header>

                {/* プライバシー説明 */}
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex gap-3 text-sm text-slate-300">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium text-emerald-300 mb-1">あなたの嗜好データはサーバに送信されません</p>
                        <p className="text-xs text-slate-400 leading-relaxed">
                            閲覧履歴と関心ベクトル（推薦エンジン）はこの端末のブラウザ内に保存されます。
                            端末をまたいで使いたい場合は、あなた自身のSupabaseプロジェクトを下で接続してください。
                            接続先のデータはあなただけが管理します。
                        </p>
                    </div>
                </div>

                {/* 個人DB接続 */}
                <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Database className="w-5 h-5 text-sky-400" />
                            個人Supabase接続
                            {connected
                                ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 ml-2"><CheckCircle2 className="w-3 h-3 mr-1" />接続中</Badge>
                                : <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30 ml-2"><XCircle className="w-3 h-3 mr-1" />未接続</Badge>}
                        </CardTitle>
                        <CardDescription>
                            自分のSupabaseプロジェクトを作成し、リポジトリの personal_supabase_schema.sql をSQL Editorで実行してから、URLとanon keyを入力してください。
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="space-y-2">
                            <label className="text-xs text-slate-400">Project URL</label>
                            <input
                                type="url"
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                placeholder="https://xxxx.supabase.co"
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs text-slate-400">anon key</label>
                            <input
                                type="password"
                                value={key}
                                onChange={e => setKey(e.target.value)}
                                placeholder="eyJhbGciOi..."
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500/50"
                            />
                        </div>
                        <div className="flex gap-2 pt-1">
                            <Button onClick={handleConnect} disabled={testing} className="bg-sky-600 hover:bg-sky-500 text-white">
                                {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                接続テスト＆保存
                            </Button>
                            {connected && (
                                <Button variant="outline" onClick={handleDisconnect} className="border-white/10 text-slate-400 hover:text-slate-200">
                                    接続解除
                                </Button>
                            )}
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                            ※ 接続情報はこの端末のブラウザ(localStorage)にのみ保存されます。共用PCでは接続しないでください。
                        </p>
                    </CardContent>
                </Card>

                {/* ローカルデータ管理 */}
                <Card className="border-white/10 bg-black/20 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="text-lg">ローカルデータ</CardTitle>
                        <CardDescription>
                            履歴 {interactionCount} 件 / 関心ベクトル {hasVector ? '学習済み' : '未生成'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={handleExport} className="border-white/10 text-slate-300 hover:text-white">
                            <Download className="w-4 h-4 mr-2" />エクスポート
                        </Button>
                        <Button variant="outline" onClick={handleImport} className="border-white/10 text-slate-300 hover:text-white">
                            <Upload className="w-4 h-4 mr-2" />インポート
                        </Button>
                        <Button variant="outline" onClick={handleReset} className="border-red-500/20 text-red-400 hover:text-red-300 hover:bg-red-500/10">
                            <Trash2 className="w-4 h-4 mr-2" />すべて削除
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
