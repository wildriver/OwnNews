'use client'

import { useState } from 'react'

interface SafeImageProps {
    src: string
    alt: string
    className?: string
}

export function SafeImage({ src, alt, className }: SafeImageProps) {
    const [imageError, setImageError] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(true) // Start visible to avoid hydration mismatch/flicker

    if (imageError || !src) return null

    return (
        <img
            src={src}
            alt={alt}
            className={`${className} transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
        />
    )
}
