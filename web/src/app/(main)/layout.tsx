import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { getInformationHealth } from '@/lib/health'

export const runtime = 'edge'

export default async function MainLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const supabase = await createClient()

    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError || !userData.user) {
        redirect('/login')
    }
    const user = userData.user

    // Fetch Health Stats for the Sidebar
    const healthStats = await getInformationHealth(supabase, user.email || '')

    return (
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
            <AppSidebar user={user} healthStats={healthStats} />
            <main className="flex-1 overflow-y-auto w-full">
                {children}
            </main>
        </div>
    )
}
