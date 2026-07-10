'use client'

// フィルタ強度スライダー（完全ローカル版）
// サーバ往復なしで即座にフィードを再計算する。
// 緑（じぶんのバブル内）→ 琥珀（視野を広げる）の意味論を色で示す。
// 0.1刻みのスナップ式（11段階）: 目盛り線と「バブル内:バブル外」比率表示で
// 「今ちょうど真ん中」「3:7で広げ気味」が分かる。段が変わる瞬間に
// バイブレーション（対応端末のみ。iOSのSafariはWeb振動API非対応）。

import { useState, useRef, useEffect } from 'react'

interface LocalFilterSliderProps {
    value: number
    onChange: (value: number) => void
}

/** スナップの刻み。0.1 = 11段階（0:10〜10:0 の比率で説明できる粒度） */
const SNAP_STEP = 0.1

export function LocalFilterSlider({ value, onChange }: LocalFilterSliderProps) {
    const [local, setLocal] = useState(value)
    const rafRef = useRef<number | null>(null)

    useEffect(() => { setLocal(value) }, [value])

    const handleChange = (raw: number) => {
        // 0.1刻みへスナップ
        const v = Math.round(Math.round(raw / SNAP_STEP) * SNAP_STEP * 100) / 100
        if (v !== local) {
            // 段が変わった瞬間にコリッと振動（Android等。iOS Safariは非対応のため無反応）
            try { navigator.vibrate?.(8) } catch { /* noop */ }
        }
        setLocal(v)
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => onChange(v))
    }

    const getLabel = () => {
        if (local <= 0.1) return 'バブル内のみ'
        if (local <= 0.35) return 'ほぼバブル内'
        if (local <= 0.65) return 'バランス'
        if (local <= 0.85) return 'バブル外多め'
        return '広く見る'
    }

    return (
        <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2 w-full md:w-auto">
            <div className="flex flex-col gap-1 flex-1 min-w-[190px]">
                <div className="flex justify-between items-baseline">
                    <span className="text-[10px] text-muted-foreground">視野の広さ</span>
                    <span className={`text-[11px] font-bold ${local <= 0.35 ? 'text-primary' : local <= 0.65 ? 'text-foreground' : 'text-amber-600'}`}>
                        {getLabel()}
                        <span className="ml-1 font-normal text-muted-foreground tnum">
                            {10 - Math.round(local * 10)}:{Math.round(local * 10)}
                        </span>
                    </span>
                </div>

                <div className="relative flex items-center">
                    {/* 目盛り（11段階・中央=バランスを強調） */}
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-between pointer-events-none" aria-hidden>
                        {Array.from({ length: 11 }).map((_, i) => (
                            <span
                                key={i}
                                className={i === 5
                                    ? 'w-[2px] h-3.5 rounded-full bg-foreground/60'
                                    : 'w-px h-2.5 rounded-full bg-foreground/40'}
                            />
                        ))}
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={SNAP_STEP}
                        value={local}
                        onChange={(e) => handleChange(parseFloat(e.target.value))}
                        aria-label="フィルタ強度（バブル外の記事の割合）"
                        className="filter-slider relative z-10 w-full h-1 appearance-none rounded-full cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, #0E9F6E 0%, #7BB88F 45%, #D97706 100%)`,
                        }}
                    />
                </div>

                <div className="flex justify-between text-[9px] text-muted-foreground/80">
                    <span>じぶんのバブル</span>
                    <span>視野を広げる</span>
                </div>
            </div>
        </div>
    )
}
