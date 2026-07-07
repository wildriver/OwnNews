'use client'

// フィルタ強度スライダー（完全ローカル版）
// サーバ往復なしで即座にフィードを再計算する。値はIndexedDBに保存され、
// 個人Supabase設定時はバックグラウンドで同期される。

import { useState, useRef } from 'react'
import { SlidersHorizontal } from 'lucide-react'

interface LocalFilterSliderProps {
    value: number
    onChange: (value: number) => void
}

export function LocalFilterSlider({ value, onChange }: LocalFilterSliderProps) {
    const [local, setLocal] = useState(value)
    const rafRef = useRef<number | null>(null)

    const handleChange = (v: number) => {
        setLocal(v)
        // 再計算は軽い（全部ローカル）のでrAFで間引くだけで即時反映
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

    const getColor = () => {
        if (local <= 0.3) return 'from-sky-400 to-indigo-400'
        if (local <= 0.7) return 'from-indigo-400 to-amber-400'
        return 'from-amber-400 to-emerald-400'
    }

    return (
        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 backdrop-blur-sm w-full md:w-auto">
            <SlidersHorizontal className="w-4 h-4 flex-shrink-0 text-slate-400" />

            <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500">バブルの外へ</span>
                    <span className={`text-[11px] font-bold text-transparent bg-clip-text bg-gradient-to-r ${getColor()}`}>
                        {getLabel()}
                    </span>
                </div>

                <div className="relative w-full">
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={local}
                        onChange={(e) => handleChange(parseFloat(e.target.value))}
                        className="filter-slider w-full h-1.5 appearance-none rounded-full cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, #38bdf8 0%, #818cf8 40%, #f59e0b 70%, #34d399 100%)`,
                        }}
                    />
                </div>

                <div className="flex justify-between text-[9px] text-slate-600">
                    <span>🫧 バブル内</span>
                    <span>🌍 広く見る</span>
                </div>
            </div>
        </div>
    )
}
