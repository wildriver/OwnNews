'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback, useRef, useEffect } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { updateFilterStrength } from '@/app/actions'

interface FilterSliderProps {
    initialValue: number
}

export function FilterSlider({ initialValue }: FilterSliderProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [value, setValue] = useState(initialValue)
    const [isUpdating, setIsUpdating] = useState(false)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Sync with URL params on navigation
    useEffect(() => {
        const urlStrength = searchParams.get('strength')
        if (urlStrength !== null) {
            setValue(parseFloat(urlStrength))
        }
    }, [searchParams])

    const handleChange = useCallback((newValue: number) => {
        setValue(newValue)

        // Debounce navigation
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(async () => {
            setIsUpdating(true)
            console.log('FilterSlider: Debounce finished, triggering update...', newValue)

            // Use replace + refresh to trigger SSR re-render without adding to history
            const params = new URLSearchParams(window.location.search)
            params.set('strength', newValue.toFixed(2))
            router.replace(`${window.location.pathname}?${params.toString()}`)

            // Persist to DB (fire and forget)
            try {
                console.log('FilterSlider: Calling updateFilterStrength server action')
                const result = await updateFilterStrength(newValue)
                console.log('FilterSlider: Server action result:', result)
            } catch (err) {
                console.error('FilterSlider: Failed to call server action:', err)
            }

            router.refresh()
            // Reset updating state after a short delay
            setTimeout(() => setIsUpdating(false), 1500)
        }, 500)
    }, [router])

    const getLabel = () => {
        if (value <= 0.15) return 'ニュートラル'
        if (value <= 0.4) return 'やや探索型'
        if (value <= 0.6) return 'バランス'
        if (value <= 0.85) return 'やや個人化'
        return 'パーソナライズ'
    }

    const getColor = () => {
        if (value <= 0.3) return 'from-emerald-400 to-cyan-400'
        if (value <= 0.7) return 'from-sky-400 to-indigo-400'
        return 'from-indigo-400 to-violet-400'
    }

    return (
        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 backdrop-blur-sm w-full md:w-auto">
            <SlidersHorizontal className={`w-4 h-4 flex-shrink-0 ${isUpdating ? 'text-sky-400 animate-pulse' : 'text-slate-400'}`} />

            <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500">フィルタ強度</span>
                    <span className={`text-[11px] font-bold text-transparent bg-clip-text bg-gradient-to-r ${getColor()}`}>
                        {isUpdating ? '更新中…' : getLabel()}
                    </span>
                </div>

                <div className="relative w-full">
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={value}
                        onChange={(e) => handleChange(parseFloat(e.target.value))}
                        className="filter-slider w-full h-1.5 appearance-none rounded-full cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, #34d399 0%, #38bdf8 50%, #818cf8 100%)`,
                        }}
                    />
                </div>

                <div className="flex justify-between text-[9px] text-slate-600">
                    <span>探索</span>
                    <span>個人化</span>
                </div>
            </div>
        </div>
    )
}
