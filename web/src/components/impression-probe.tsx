'use client'

// 「その面が実際に画面に出た」ことを1セッション1回だけ記録する薄いラッパ。
// クリック数だけでは率の分母が無い（見た人が分からない）ため、
// 無関心期→関心期の遷移率を出すのに要る。IntersectionObserverで実際に
// 可視になった時だけ記録し、DOMに存在するだけでは数えない。

import { useEffect, useRef } from 'react'
import { logImpression, Surface } from '@/lib/client/events'

export function ImpressionProbe({ surface, children }: { surface: Surface; children: React.ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const el = ref.current
        if (!el || typeof IntersectionObserver === 'undefined') return
        const io = new IntersectionObserver(entries => {
            for (const e of entries) {
                if (e.isIntersecting) { logImpression(surface); io.disconnect(); break }
            }
        }, { threshold: 0.5 })
        io.observe(el)
        return () => io.disconnect()
    }, [surface])

    return <div ref={ref} className="contents">{children}</div>
}
