import { AppSidebar } from '@/components/app-sidebar'
import { MobileNav } from '@/components/mobile-nav'
import { VersionBadge } from '@/components/version-badge'

export const runtime = 'edge'

// ローカルファースト: レイアウトでの認証チェック・サーバ側統計取得はなし。
// デスクトップ=サイドバー / モバイル=ボトムナビ。
export default function MainLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <AppSidebar />
            <main className="flex-1 overflow-y-auto w-full pb-16 md:pb-0">
                {children}
            </main>
            <MobileNav />
            <VersionBadge />
        </div>
    )
}
