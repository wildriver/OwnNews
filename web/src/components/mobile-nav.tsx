'use client'

// モバイル用ボトムナビゲーション（md未満で表示）
// デスクトップはサイドバー、モバイルはこのタブバーが唯一のナビになる。

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Newspaper, LayoutDashboard, History, Settings } from 'lucide-react'

const ITEMS = [
    { href: '/', label: 'フィード', icon: Newspaper },
    { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
    { href: '/history', label: '履歴', icon: History },
    { href: '/settings', label: '設定', icon: Settings },
]

export function MobileNav() {
    const pathname = usePathname()

    return (
        <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-card border-t border-border pb-[env(safe-area-inset-bottom)]">
            <div className="grid grid-cols-4">
                {ITEMS.map(({ href, label, icon: Icon }) => {
                    const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Icon className="w-5 h-5" strokeWidth={active ? 2.2 : 1.8} />
                            {label}
                        </Link>
                    )
                })}
            </div>
        </nav>
    )
}
