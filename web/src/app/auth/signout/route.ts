import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const runtime = 'edge'

export async function GET() {
    const supabase = await createClient()

    // Sign out
    await supabase.auth.signOut()

    // Redirect to login or home
    return redirect('/login')
}

export async function POST() {
    const supabase = await createClient()

    // Sign out
    await supabase.auth.signOut()

    // Redirect to login or home
    return redirect('/login')
}
