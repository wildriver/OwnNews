import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppSidebar } from '@/components/app-sidebar'
import { MobileNav } from '@/components/mobile-nav'
import { VersionBadge } from '@/components/version-badge'
import { CloudSync } from '@/components/cloud-sync'

export const runtime = 'edge'

// 複数人が使うサイト。Googleログインでユーザーを識別し、推薦データを
// 運営Supabaseにユーザー単位で保存する（推薦計算は各端末で実行）。
export default async function MainLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        // 未ログインはランディングページへ（サービス紹介＋ログイン導線）
        redirect('/welcome')
    }

    return (
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <CloudSync />
            <AppSidebar userEmail={user.email ?? ''} />
            <main className="flex-1 overflow-y-auto w-full pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
                {children}
            </main>
            <MobileNav />
            <VersionBadge />
        </div>
    )
}
