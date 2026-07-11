'use client'

// 運営（管理者）ダッシュボード。
// 利用者数・閲覧状況・フィルタバブルの違いを俯瞰する。
// データは認証済み匿名キー経由の集計RPC（is_admin()ガード）から取得。
// 管理者以外がURLを直接開いてもRPCが弾くため、何も表示されない。

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Users, Eye, Sparkles, EyeOff, BellRing, Gauge, ShieldAlert } from 'lucide-react'
import { fetchAdminData, AdminData, anonUser } from '@/lib/client/admin'
import { deriveBubbleProfiles, BubbleHeatmap, DiversityScatter, RadarGrid } from '@/components/admin-bubble-viz'

// ジャンル配色（既存のGlobalCategoryBarと統一）
const CAT_COLORS: Record<string, string> = {
    'IT': 'bg-primary',
    '政治': 'bg-red-500',
    '経済': 'bg-amber-500',
    '国際': 'bg-blue-500',
    '社会': 'bg-orange-500',
    'スポーツ': 'bg-emerald-500',
    'エンターテイメント': 'bg-violet-500',
    'サイエンス': 'bg-cyan-500',
    '地方・地域': 'bg-lime-500',
    '中国・韓国': 'bg-rose-500',
    '訃報・人事': 'bg-slate-500',
    'その他': 'bg-slate-400',
}
const catColor = (c: string | null) => (c && CAT_COLORS[c]) || 'bg-slate-400'

function fmtRelative(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    const diff = Date.now() - d.getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'たった今'
    if (min < 60) return `${min}分前`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}時間前`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day}日前`
    return `${d.getMonth() + 1}/${d.getDate()}`
}

// KPIカード
function Kpi({ icon: Icon, label, value, sub }: {
    icon: React.ComponentType<{ className?: string }>
    label: string; value: string | number; sub?: string
}) {
    return (
        <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
                <Icon className="w-3.5 h-3.5" />{label}
            </div>
            <div className="text-2xl font-bold tnum leading-none">{value}</div>
            {sub && <div className="text-[10px] text-muted-foreground mt-1">{sub}</div>}
        </div>
    )
}

// 日次アクティビティのSVGスパークライン（閲覧数の折れ線＋アクティブ人数の面）
function DailySparkline({ data }: { data: AdminData['daily'] }) {
    if (data.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">データがありません</p>
    const W = 720, H = 120, pad = 4
    const maxV = Math.max(...data.map(d => d.views), 1)
    const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(data.length - 1, 1)
    const y = (v: number) => H - pad - (v / maxV) * (H - 2 * pad)
    const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(d.views).toFixed(1)}`).join(' ')
    const area = `${line} L ${x(data.length - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`
    const first = data[0]?.day, last = data[data.length - 1]?.day
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
                <path d={area} className="fill-primary/10" />
                <path d={line} className="stroke-primary fill-none" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tnum">
                <span>{first?.slice(5)}</span>
                <span>最大 {maxV.toLocaleString()} 閲覧/日</span>
                <span>{last?.slice(5)}</span>
            </div>
        </div>
    )
}

// 横棒（フィルタ強度ヒストグラム / ジャンル分布 共用）
function HBars({ rows }: { rows: { label: string; value: number; color: string; hint?: string }[] }) {
    const max = Math.max(...rows.map(r => r.value), 1)
    const total = rows.reduce((s, r) => s + r.value, 0)
    return (
        <div className="space-y-2.5">
            {rows.map(r => {
                const pct = total > 0 ? ((r.value / total) * 100).toFixed(0) : '0'
                return (
                    <div key={r.label} className="flex items-center gap-3">
                        <div className="w-24 shrink-0 text-right text-[11px] text-muted-foreground truncate">{r.label}</div>
                        <div className="flex-1 bg-secondary rounded-full h-4 overflow-hidden">
                            <div className={`h-full rounded-full ${r.color} opacity-80 transition-all`} style={{ width: `${(r.value / max) * 100}%` }} />
                        </div>
                        <div className="w-20 shrink-0 text-[11px] text-muted-foreground tnum">
                            {r.value.toLocaleString()}<span className="text-muted-foreground/60 ml-1">({pct}%)</span>
                        </div>
                    </div>
                )
            })}
            {rows.every(r => r.value === 0) && <p className="text-sm text-muted-foreground text-center py-4">データがありません</p>}
        </div>
    )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
    return (
        <section className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-[13px] font-bold">{title}</h2>
            {desc && <p className="text-[11px] text-muted-foreground mt-0.5 mb-3">{desc}</p>}
            {!desc && <div className="mb-3" />}
            {children}
        </section>
    )
}

export default function AdminPage() {
    const [state, setState] = useState<'loading' | 'forbidden' | 'ready'>('loading')
    const [data, setData] = useState<AdminData | null>(null)

    useEffect(() => {
        fetchAdminData(30).then(d => {
            if (d) { setData(d); setState('ready') }
            else setState('forbidden')
        }).catch(() => setState('forbidden'))
    }, [])

    if (state === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
            </div>
        )
    }

    if (state === 'forbidden' || !data) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center text-center px-6 gap-2">
                <ShieldAlert className="h-8 w-8 text-muted-foreground" />
                <h1 className="text-base font-bold">この画面は運営者専用です</h1>
                <p className="text-[12px] text-muted-foreground max-w-sm">
                    アクセス権がありません。運営者は Supabase の admin_users にログイン用メールを登録してください。
                </p>
            </div>
        )
    }

    return <AdminDashboard data={data} />
}

function AdminDashboard({ data }: { data: AdminData }) {
    // ユーザー×ジャンル行列からバブルプロファイル（共通軸・シェア・多様性）を導出
    const bubble = useMemo(
        () => data.matrix && data.matrix.length > 0
            ? deriveBubbleProfiles(data.matrix, data.users)
            : null,
        [data.matrix, data.users]
    )

    const s = data.summary
    const filterRows = data.filterHistogram.map(b => ({
        label: b.bucket, value: b.cnt,
        color: b.bucket.startsWith('0.0') || b.bucket.startsWith('0.2') ? 'bg-primary' : b.bucket.startsWith('0.4') ? 'bg-amber-500' : 'bg-emerald-500',
        hint: '',
    }))
    const catRows = data.categories.slice(0, 12).map(c => ({
        label: c.category || 'その他', value: c.views, color: catColor(c.category),
    }))

    return (
        <div className="min-h-screen bg-background text-foreground p-4 md:p-8">
            <div className="max-w-5xl mx-auto space-y-5">
                <header>
                    <h1 className="text-xl font-bold tracking-tight">運営ダッシュボード</h1>
                    <p className="text-[12px] text-muted-foreground">
                        利用者数・閲覧状況・フィルタバブルの違いを観測します（過去30日）。
                    </p>
                </header>

                {/* KPI */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Kpi icon={Users} label="登録ユーザー" value={s.total_users}
                        sub={`7日アクティブ ${s.active_7d} / 30日 ${s.active_30d}`} />
                    <Kpi icon={Eye} label="総閲覧" value={s.total_views.toLocaleString()}
                        sub={`うち深掘り ${s.total_deep_dives.toLocaleString()}`} />
                    <Kpi icon={Gauge} label="平均フィルタ強度" value={s.avg_filter_strength ?? '—'}
                        sub="0=バブル寄り / 1=視野を広げる" />
                    <Kpi icon={BellRing} label="Push購読者" value={s.push_subscribers}
                        sub={s.avg_dwell_sec != null ? `平均滞在 ${s.avg_dwell_sec}秒` : undefined} />
                </div>

                {/* 日次アクティビティ */}
                <Section title="閲覧アクティビティ推移" desc="日ごとの総閲覧数（過去30日）">
                    <DailySparkline data={data.daily} />
                </Section>

                <div className="grid md:grid-cols-2 gap-5">
                    {/* フィルタ強度分布（核心） */}
                    <Section title="フィルタ強度の分布" desc="ユーザーが「視野の広さ」をどこに置いているか。左ほど自分のバブル、右ほど視野を広げる設定。">
                        <HBars rows={filterRows} />
                    </Section>

                    {/* 全体ジャンル分布 */}
                    <Section title="ジャンル別の閲覧（全ユーザー）" desc="全員の閲覧を合算したジャンル分布（上位12）">
                        <HBars rows={catRows} />
                    </Section>
                </div>

                {/* バブルの可視化（ユーザー×ジャンル行列から導出） */}
                {bubble ? (
                    <>
                        <Section
                            title="バブルのかたち（ヒートマップ）"
                            desc="行=ユーザー、列=ジャンル、濃さ=そのユーザーの閲覧に占めるシェア。濃い列が固まっている人ほどバブルが強い。数字は%（15%以上のみ表示）。"
                        >
                            <BubbleHeatmap genres={bubble.genres} profiles={bubble.profiles} />
                        </Section>

                        <div className="grid md:grid-cols-2 gap-5">
                            <Section
                                title="設定 × 実態"
                                desc="横=フィルタ強度（本人が設定した視野の広さ）、縦=閲覧の実際の多様性（エントロピー）。設定どおりに多様に読めているかのギャップが見える。"
                            >
                                <DiversityScatter profiles={bubble.profiles} />
                            </Section>

                            <Section
                                title="バブルの形（レーダー）"
                                desc="ユーザーごとのジャンル分布。同一スケールなので形と大きさを直接比較できる。"
                            >
                                <RadarGrid genres={bubble.genres} profiles={bubble.profiles} />
                            </Section>
                        </div>
                    </>
                ) : (
                    <Section title="バブルの可視化">
                        <p className="text-[12px] text-muted-foreground">
                            ヒートマップ・散布図・レーダーを表示するには、Supabase SQL Editor で migrate_admin_viz.sql を実行してください。
                        </p>
                    </Section>
                )}

                {/* ユーザー別 */}
                <Section title="ユーザー別の観測" desc="バブル集中度 = 最も読むジャンルが閲覧全体に占める割合。高いほど単一ジャンルに偏り（バブルが強い）。IDは匿名加工（同一ユーザーは常に同じID）。">
                    <div className="overflow-x-auto -mx-1">
                        <table className="w-full text-[12px] min-w-[640px]">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                                    <th className="text-left font-medium py-2 px-2">ユーザー</th>
                                    <th className="text-right font-medium py-2 px-2">閲覧</th>
                                    <th className="text-right font-medium py-2 px-2">深掘り</th>
                                    <th className="text-right font-medium py-2 px-2">非表示</th>
                                    <th className="text-left font-medium py-2 px-2">フィルタ強度</th>
                                    <th className="text-left font-medium py-2 px-2">バブル集中度</th>
                                    <th className="text-right font-medium py-2 px-2">最終</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {data.users.map(u => {
                                    const ratio = u.top_ratio != null ? Math.round(u.top_ratio * 100) : null
                                    const fs = u.filter_strength ?? 0.5
                                    return (
                                        <tr key={u.user_id} className="hover:bg-secondary/50">
                                            <td className="py-2 px-2 tnum">{anonUser(u.user_id)}</td>
                                            <td className="py-2 px-2 text-right tnum">{u.views}</td>
                                            <td className="py-2 px-2 text-right tnum text-indigo-600">{u.deep_dives || ''}</td>
                                            <td className="py-2 px-2 text-right tnum text-muted-foreground">{u.dismissed || ''}</td>
                                            <td className="py-2 px-2">
                                                <div className="flex items-center gap-1.5">
                                                    <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                                        <div className="h-full bg-foreground/50 rounded-full" style={{ width: `${fs * 100}%` }} />
                                                    </div>
                                                    <span className="tnum text-[10px] text-muted-foreground">{fs.toFixed(2)}</span>
                                                </div>
                                            </td>
                                            <td className="py-2 px-2">
                                                {ratio != null ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <span className={`inline-block w-2 h-2 rounded-full ${catColor(u.top_category)}`} />
                                                        <span className="text-[11px] truncate max-w-[80px]">{u.top_category}</span>
                                                        <span className={`tnum text-[10px] font-semibold ${ratio >= 60 ? 'text-rose-600' : ratio >= 40 ? 'text-amber-600' : 'text-emerald-600'}`}>{ratio}%</span>
                                                    </div>
                                                ) : <span className="text-muted-foreground/50">—</span>}
                                            </td>
                                            <td className="py-2 px-2 text-right text-muted-foreground tnum">{fmtRelative(u.last_active)}</td>
                                        </tr>
                                    )
                                })}
                                {data.users.length === 0 && (
                                    <tr><td colSpan={7} className="text-center py-6 text-muted-foreground">ユーザーがいません</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1"><EyeOff className="w-3 h-3" />非表示=興味なし操作</span>
                        <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-indigo-600" />深掘り=AI要約を開いた回数</span>
                    </div>
                </Section>
            </div>
        </div>
    )
}
