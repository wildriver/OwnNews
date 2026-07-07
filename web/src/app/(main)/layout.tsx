import { AppSidebar } from '@/components/app-sidebar'
import { VersionBadge } from '@/components/version-badge'

export const runtime = 'edge'

// ローカルファースト化に伴い、レイアウトでの認証チェックと
// サーバ側ヘルス統計取得を廃止。サイドバーの統計はクライアントで計算する。
export default function MainLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <AppSidebar />
            <main className="flex-1 overflow-y-auto w-full">
                {children}
            </main>
            <VersionBadge />
        </div>
    )
}
