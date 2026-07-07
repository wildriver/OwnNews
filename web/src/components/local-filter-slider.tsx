'use client'

// フィルタ強度スライダー（完全ローカル版）
// サーバ往復なしで即座にフィードを再計算する。
// 緑（じぶんのバブル内）→ 琥珀（視野を広げる）の意味論を色で示す。

import { useState, useRef, useEffect } from 'react'

interface LocalFilterSliderProps {
    value: number
    onChange: (value: number) => void
}

export function LocalFilterSlider({ value, onChange }: LocalFilterSliderProps) {
    const [local, setLocal] = useState(value)
    const rafRef = useRef<number | null>(null)

    useEffect(() => { setLocal(value) }, [value])

    const handleChange = (v: number) => {
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
                    </span>
                </div>

                <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={local}
                    onChange={(e) => handleChange(parseFloat(e.target.value))}
                    aria-label="フィルタ強度（バブル外の記事の割合）"
                    className="filter-slider w-full h-1 appearance-none rounded-full cursor-pointer"
                    style={{
                        background: `linear-gradient(to right, #0E9F6E 0%, #7BB88F 45%, #D97706 100%)`,
                    }}
                />

                <div className="flex justify-between text-[9px] text-muted-foreground/80">
                    <span>じぶんのバブル</span>
                    <span>視野を広げる</span>
                </div>
            </div>
        </div>
    )
}
