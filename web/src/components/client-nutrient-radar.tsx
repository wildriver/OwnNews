"use client"

import dynamic from 'next/dynamic'
import React from 'react'

export const ClientNutrientRadar = dynamic(
    () => import('./nutrient-radar').then(mod => mod.NutrientRadar),
    {
        ssr: false,
        loading: () => <div className="h-[300px] w-full bg-white/5 animate-pulse rounded-full opacity-20" />
    }
)
