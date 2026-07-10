'use client'

// 表示サイズ（読みテキスト）の切替コントロール。
// 値は localStorage に保存し、<html data-textsize> を切り替えて
// globals.css の --fs-* 変数を上書きする。レイアウト幅は変えないので
// モバイルでも横スクロールしない。

import { useState, useEffect } from 'react'

export type TextSize = 'normal' | 'large' | 'xlarge'
const STORAGE_KEY = 'ownnews_textsize'
const SIZES: { id: TextSize; label: string; a: string }[] = [
    { id: 'normal', label: '標準', a: 'text-[12px]' },
    { id: 'large', label: '大', a: 'text-[16px]' },
    { id: 'xlarge', label: '特大', a: 'text-[21px]' },
]

export function applyTextSize(size: TextSize) {
    document.documentElement.dataset.textsize = size
}

export function TextSizeControl({ className = '' }: { className?: string }) {
    const [size, setSize] = useState<TextSize>('normal')

    useEffect(() => {
        const stored = (localStorage.getItem(STORAGE_KEY) as TextSize | null) || 'normal'
        setSize(stored)
        applyTextSize(stored)
    }, [])

    const choose = (s: TextSize) => {
        setSize(s)
        localStorage.setItem(STORAGE_KEY, s)
        applyTextSize(s)
    }

    return (
        <div
            // display（inline-flex/hidden 等）は呼び出し側で指定する。
            // ここでハードコードすると hidden 指定と競合するため付けない。
            className={`items-center rounded-lg border border-border bg-card p-0.5 ${className}`}
            role="group"
            aria-label="文字サイズ"
        >
            {SIZES.map(({ id, label, a }) => (
                <button
                    key={id}
                    onClick={() => choose(id)}
                    aria-pressed={size === id}
                    title={`文字サイズ: ${label}`}
                    className={`flex items-center justify-center h-7 min-w-8 px-1.5 rounded-md font-bold leading-none transition-colors ${a} ${size === id
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                        }`}
                >
                    A
                </button>
            ))}
        </div>
    )
}
