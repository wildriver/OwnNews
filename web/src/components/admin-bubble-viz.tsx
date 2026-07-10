'use client'

// 運営ダッシュボード: フィルタバブルの可視化群。
// admin_user_category_matrix()（ユーザー×ジャンルの閲覧行列）から
// すべてクライアント側で導出する。
//   1. ヒートマップ   — 全ユーザーのバブルの偏りを一望（濃い=そのジャンルに集中）
//   2. 散布図         — 設定(フィルタ強度) × 実態(閲覧多様性) のギャップ
//   3. レーダー小倍数 — ユーザーごとの「バブルの形」を並べて比較

import { useMemo } from 'react'
import { UserCategoryCell, UserDetail } from '@/lib/client/admin'

// SVG用のジャンル配色（テーブルのtailwindクラス配色と同系のhex）
const CAT_HEX: Record<string, string> = {
    'IT': '#0E9F6E',
    '政治': '#ef4444',
    '経済': '#f59e0b',
    '国際': '#3b82f6',
    '社会': '#f97316',
    'スポーツ': '#10b981',
    'エンターテイメント': '#8b5cf6',
    'サイエンス': '#06b6d4',
    '地方・地域': '#84cc16',
    '中国・韓国': '#f43f5e',
    '訃報・人事': '#64748b',
    'その他': '#94a3b8',
}
const catHex = (c: string | null | undefined) => (c && CAT_HEX[c]) || '#94a3b8'

// ヒートマップ列ヘッダ用の短縮名
const SHORT: Record<string, string> = {
    'エンターテイメント': 'エンタメ',
    '地方・地域': '地方',
    '中国・韓国': '中韓',
    '訃報・人事': '訃報',
    'サイエンス': '科学',
}
const short = (c: string) => SHORT[c] ?? c

const MAX_HEATMAP_ROWS = 30
const MAX_RADARS = 12

export interface BubbleProfile {
    user_id: string
    total: number
    /** ジャンル→閲覧シェア(0-1)。軸はグローバル上位ジャンルに揃える */
    shares: Map<string, number>
    /** 正規化エントロピー(0-1)。1=全ジャンル均等、0=単一ジャンル */
    entropy: number
    filter_strength: number | null
}

/** 行列から、共通のジャンル軸と各ユーザーのバブルプロファイルを導出 */
export function deriveBubbleProfiles(
    matrix: UserCategoryCell[],
    users: UserDetail[],
    axisCount = 8,
): { genres: string[]; profiles: BubbleProfile[] } {
    // グローバル上位ジャンル = 共通の軸（比較のため全ユーザーで揃える）
    const globalCounts = new Map<string, number>()
    for (const cell of matrix) {
        globalCounts.set(cell.category, (globalCounts.get(cell.category) ?? 0) + cell.views)
    }
    const genres = [...globalCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, axisCount)
        .map(([g]) => g)

    const fsByUser = new Map(users.map(u => [u.user_id, u.filter_strength]))

    const byUser = new Map<string, UserCategoryCell[]>()
    for (const cell of matrix) {
        const arr = byUser.get(cell.user_id) ?? []
        arr.push(cell)
        byUser.set(cell.user_id, arr)
    }

    const profiles: BubbleProfile[] = []
    for (const [user_id, cells] of byUser) {
        const total = cells.reduce((s, c) => s + c.views, 0)
        if (total === 0) continue
        // 軸外ジャンルは「その他扱い」でエントロピーにだけ寄与させず、シェアは軸のみ
        const shares = new Map<string, number>()
        for (const g of genres) {
            const v = cells.filter(c => c.category === g).reduce((s, c) => s + c.views, 0)
            shares.set(g, v / total)
        }
        // エントロピーは実際の全ジャンル分布で計算（軸に丸めない）
        let h = 0
        for (const c of cells) {
            const p = c.views / total
            if (p > 0) h -= p * Math.log(p)
        }
        const k = Math.max(genres.length, cells.length, 2)
        profiles.push({
            user_id, total, shares,
            entropy: Math.min(h / Math.log(k), 1),
            filter_strength: fsByUser.get(user_id) ?? null,
        })
    }
    profiles.sort((a, b) => b.total - a.total)
    return { genres, profiles }
}

// ============================================================
// 1. ヒートマップ（ユーザー × ジャンル）
// ============================================================
export function BubbleHeatmap({ genres, profiles }: { genres: string[]; profiles: BubbleProfile[] }) {
    const rows = profiles.slice(0, MAX_HEATMAP_ROWS)
    if (rows.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">データがありません</p>
    return (
        <div className="overflow-x-auto">
            <div className="min-w-[560px]">
                {/* ヘッダ行 */}
                <div className="grid gap-px" style={{ gridTemplateColumns: `140px repeat(${genres.length}, 1fr) 44px` }}>
                    <div />
                    {genres.map(g => (
                        <div key={g} className="text-[9px] text-muted-foreground text-center pb-1 truncate" title={g}>{short(g)}</div>
                    ))}
                    <div className="text-[9px] text-muted-foreground text-center pb-1">閲覧</div>
                </div>
                {/* 本体 */}
                <div className="space-y-px">
                    {rows.map(p => (
                        <div key={p.user_id} className="grid gap-px items-center" style={{ gridTemplateColumns: `140px repeat(${genres.length}, 1fr) 44px` }}>
                            <div className="text-[10px] text-muted-foreground truncate pr-2" title={p.user_id}>
                                {p.user_id.split('@')[0]}
                            </div>
                            {genres.map(g => {
                                const s = p.shares.get(g) ?? 0
                                // sqrtで低シェアも視認できるよう持ち上げる
                                const alpha = Math.pow(s, 0.6)
                                return (
                                    <div
                                        key={g}
                                        className="h-6 rounded-[3px] flex items-center justify-center"
                                        style={{ backgroundColor: `rgba(14,159,110,${alpha.toFixed(3)})` }}
                                        title={`${p.user_id} × ${g}: ${(s * 100).toFixed(1)}%`}
                                    >
                                        {s >= 0.15 && (
                                            <span className={`text-[9px] tnum ${s >= 0.45 ? 'text-white' : 'text-foreground/70'}`}>
                                                {Math.round(s * 100)}
                                            </span>
                                        )}
                                    </div>
                                )
                            })}
                            <div className="text-[10px] text-muted-foreground text-right tnum pl-1">{p.total}</div>
                        </div>
                    ))}
                </div>
                {profiles.length > MAX_HEATMAP_ROWS && (
                    <p className="text-[10px] text-muted-foreground mt-2">閲覧数上位{MAX_HEATMAP_ROWS}名を表示（全{profiles.length}名）</p>
                )}
            </div>
        </div>
    )
}

// ============================================================
// 2. 散布図: 設定(フィルタ強度) × 実態(閲覧多様性)
// ============================================================
export function DiversityScatter({ profiles }: { profiles: BubbleProfile[] }) {
    const pts = profiles.filter(p => p.filter_strength != null)
    const W = 400, H = 280, pad = { l: 34, r: 12, t: 12, b: 30 }
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
    const x = (v: number) => pad.l + v * iw
    const y = (v: number) => pad.t + (1 - v) * ih
    const maxTotal = Math.max(...pts.map(p => p.total), 1)
    const topCat = (p: BubbleProfile) => {
        let best: string | null = null, bv = -1
        for (const [g, s] of p.shares) if (s > bv) { bv = s; best = g }
        return best
    }
    if (pts.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">データがありません</p>
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
                {/* 枠と中央ガイド */}
                <rect x={pad.l} y={pad.t} width={iw} height={ih} className="fill-secondary/40" rx={6} />
                <line x1={x(0.5)} y1={pad.t} x2={x(0.5)} y2={pad.t + ih} className="stroke-border" strokeDasharray="3 3" />
                <line x1={pad.l} y1={y(0.5)} x2={pad.l + iw} y2={y(0.5)} className="stroke-border" strokeDasharray="3 3" />
                {/* 象限ラベル */}
                <text x={x(0.03)} y={y(0.04)} className="fill-muted-foreground" fontSize={8}>深いバブル（狭い設定・偏った閲覧）</text>
                <text x={x(0.97)} y={y(0.96)} className="fill-muted-foreground" fontSize={8} textAnchor="end">開かれた読者（広い設定・多様な閲覧）</text>
                {/* 軸ラベル */}
                <text x={pad.l + iw / 2} y={H - 6} className="fill-muted-foreground" fontSize={9} textAnchor="middle">フィルタ強度（設定した視野の広さ）→</text>
                <text x={10} y={pad.t + ih / 2} className="fill-muted-foreground" fontSize={9} textAnchor="middle" transform={`rotate(-90 10 ${pad.t + ih / 2})`}>閲覧の多様性（実態）→</text>
                {/* 目盛 */}
                {[0, 0.5, 1].map(v => (
                    <g key={v}>
                        <text x={x(v)} y={pad.t + ih + 12} className="fill-muted-foreground" fontSize={8} textAnchor="middle">{v}</text>
                        <text x={pad.l - 5} y={y(v) + 3} className="fill-muted-foreground" fontSize={8} textAnchor="end">{v}</text>
                    </g>
                ))}
                {/* 点 */}
                {pts.map(p => {
                    const r = 4 + 8 * Math.sqrt(p.total / maxTotal)
                    const cat = topCat(p)
                    return (
                        <g key={p.user_id}>
                            <circle
                                cx={x(p.filter_strength!)} cy={y(p.entropy)} r={r}
                                fill={catHex(cat)} fillOpacity={0.55} stroke={catHex(cat)} strokeWidth={1.5}
                            >
                                <title>{`${p.user_id}\n強度 ${p.filter_strength!.toFixed(2)} / 多様性 ${p.entropy.toFixed(2)} / ${p.total}閲覧 / 最多: ${cat}`}</title>
                            </circle>
                            {pts.length <= 12 && (
                                <text x={x(p.filter_strength!)} y={y(p.entropy) - r - 3} fontSize={8} textAnchor="middle" className="fill-muted-foreground">
                                    {p.user_id.split('@')[0].slice(0, 10)}
                                </text>
                            )}
                        </g>
                    )
                })}
            </svg>
            <p className="text-[10px] text-muted-foreground mt-1.5">
                対角線から外れた人ほど「設定と実態のギャップ」が大きい。円の大きさ=閲覧数、色=最多ジャンル。
            </p>
        </div>
    )
}

// ============================================================
// 3. レーダー小倍数（ユーザーごとのバブルの形）
// ============================================================
function Radar({ p, genres, maxShare }: { p: BubbleProfile; genres: string[]; maxShare: number }) {
    const S = 150, cx = S / 2, cy = S / 2 + 4, R = 46
    const n = genres.length
    const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n
    const pt = (i: number, r: number) => `${(cx + r * Math.cos(angle(i))).toFixed(1)},${(cy + r * Math.sin(angle(i))).toFixed(1)}`
    // sqrtスケール: 支配的ジャンルのスパイクを保ちつつ、小シェアの軸も視認できるようにする
    const rOf = (g: string) => R * Math.sqrt(Math.min((p.shares.get(g) ?? 0) / maxShare, 1))
    const poly = genres.map((g, i) => pt(i, rOf(g))).join(' ')
    return (
        <div className="bg-secondary/40 rounded-lg p-2">
            <svg viewBox={`0 0 ${S} ${S}`} className="w-full h-auto">
                {/* グリッド */}
                {[0.33, 0.66, 1].map(f => (
                    <polygon key={f} points={genres.map((_, i) => pt(i, R * f)).join(' ')} className="fill-none stroke-border" strokeWidth={0.5} />
                ))}
                {genres.map((_, i) => (
                    <line key={i} x1={cx} y1={cy}
                        x2={cx + R * Math.cos(angle(i))} y2={cy + R * Math.sin(angle(i))}
                        className="stroke-border" strokeWidth={0.5} />
                ))}
                {/* 本体 */}
                <polygon points={poly} fill="#0E9F6E" fillOpacity={0.3} stroke="#0E9F6E" strokeWidth={1.5} strokeLinejoin="round" />
                {/* 軸ラベル */}
                {genres.map((g, i) => {
                    const lx = cx + (R + 13) * Math.cos(angle(i))
                    const ly = cy + (R + 13) * Math.sin(angle(i))
                    return <text key={g} x={lx} y={ly + 3} fontSize={8} textAnchor="middle" className="fill-muted-foreground">{short(g)}</text>
                })}
            </svg>
            <div className="text-center mt-1">
                <div className="text-[10px] font-medium truncate" title={p.user_id}>{p.user_id.split('@')[0]}</div>
                <div className="text-[9px] text-muted-foreground tnum">{p.total}閲覧 / 多様性 {p.entropy.toFixed(2)}</div>
            </div>
        </div>
    )
}

export function RadarGrid({ genres, profiles }: { genres: string[]; profiles: BubbleProfile[] }) {
    // レーダー軸は上位6ジャンルに絞る（多角形が潰れないように）
    const axes = genres.slice(0, 6)
    const rows = profiles.slice(0, MAX_RADARS)
    // 全ユーザー共通のスケール（形の比較のため）
    const maxShare = useMemo(() => {
        let m = 0.3
        for (const p of rows) for (const g of axes) m = Math.max(m, p.shares.get(g) ?? 0)
        return m
    }, [rows, axes])
    if (rows.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">データがありません</p>
    return (
        <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {rows.map(p => <Radar key={p.user_id} p={p} genres={axes} maxShare={maxShare} />)}
            </div>
            {profiles.length > MAX_RADARS && (
                <p className="text-[10px] text-muted-foreground mt-2">閲覧数上位{MAX_RADARS}名を表示（全{profiles.length}名）</p>
            )}
        </div>
    )
}
