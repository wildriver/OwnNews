'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useCallback, useRef, useEffect } from 'react'
import { Layers } from 'lucide-react'
import { updateGroupingThreshold } from '@/app/actions'

interface GroupingSliderProps {
    initialValue: number
}

export function GroupingSlider({ initialValue }: GroupingSliderProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [value, setValue] = useState(initialValue)
    const [isUpdating, setIsUpdating] = useState(false)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Sync with URL params on navigation
    useEffect(() => {
        const urlGrouping = searchParams.get('grouping')
        if (urlGrouping !== null) {
            setValue(parseFloat(urlGrouping))
        }
    }, [searchParams])

    const handleChange = useCallback((newValue: number) => {
        setValue(newValue)

        // Debounce navigation and persistence
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }
        timeoutRef.current = setTimeout(async () => {
            setIsUpdating(true)

            // Use replace + refresh to trigger SSR re-render without adding to history
            const params = new URLSearchParams(window.location.search)
            params.set('grouping', newValue.toFixed(2))
            router.replace(`${window.location.pathname}?${params.toString()}`)

            // Persist to DB
            await updateGroupingThreshold(newValue)

            router.refresh()
            // Reset updating state after a short delay
            setTimeout(() => setIsUpdating(false), 1500)
        }, 500)
    }, [router])

    const getLabel = () => {
        if (value >= 0.98) return '超厳格'
        if (value >= 0.95) return '厳格'
        if (value >= 0.90) return 'バランス'
        if (value >= 0.85) return 'ゆるめ'
        return '広範囲'
    }

    const getColor = () => {
        if (value >= 0.95) return 'from-rose-400 to-orange-400'
        if (value >= 0.88) return 'from-amber-400 to-yellow-400'
        return 'from-lime-400 to-emerald-400'
    }

    return (
        <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3 backdrop-blur-sm w-full md:w-auto">
            <Layers className={`w-4 h-4 flex-shrink-0 ${isUpdating ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`} />

            <div className="flex flex-col gap-1.5 flex-1 min-w-[180px]">
                <div className="flex justify-between items-center">
                    <span className="text-[11px] text-slate-500">まとめ強度</span>
                    <span className={`text-[11px] font-bold text-transparent bg-clip-text bg-gradient-to-r ${getColor()}`}>
                        {isUpdating ? '更新中…' : getLabel()}
                    </span>
                </div>

                <div className="relative w-full">
                    <input
                        type="range"
                        min={0.70}
                        max={0.99}
                        step={0.01}
                        value={value}
                        onChange={(e) => handleChange(parseFloat(e.target.value))}
                        className="filter-slider w-full h-1.5 appearance-none rounded-full cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, #10b981 0%, #f59e0b 50%, #f43f5e 100%)`,
                        }}
                    />
                </div>

                <div className="flex justify-between text-[9px] text-slate-600">
                    <span>広域</span>
                    <span>厳密</span>
                </div>
            </div>
        </div>
    )
}
