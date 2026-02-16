import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function GET() {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const userEmail = user.email || ''

    // Check user_vectors
    const { data: vectorData, error: vecError } = await supabase
        .from('user_vectors')
        .select('user_id, updated_at')
        .eq('user_id', userEmail)
        .single()

    // Check if vector_m3 exists (separate query to avoid transferring huge vector)
    const { data: vecCheck } = await supabase
        .rpc('check_user_vector_m3', { uid: userEmail })
        .single()

    // Fallback: raw query to check vector_m3 length
    let vectorM3Info = null
    try {
        const { data: rawVec } = await supabase
            .from('user_vectors')
            .select('vector_m3')
            .eq('user_id', userEmail)
            .single()
        if (rawVec?.vector_m3) {
            const parsed = typeof rawVec.vector_m3 === 'string'
                ? JSON.parse(rawVec.vector_m3)
                : rawVec.vector_m3
            vectorM3Info = {
                exists: true,
                type: typeof rawVec.vector_m3,
                length: Array.isArray(parsed) ? parsed.length : 'not_array',
                sample: Array.isArray(parsed) ? parsed.slice(0, 3) : null,
            }
        } else {
            vectorM3Info = { exists: false }
        }
    } catch (e) {
        vectorM3Info = { exists: false, error: String(e) }
    }

    // Check interactions count
    const { count: interactionCount } = await supabase
        .from('user_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userEmail)

    const { count: viewCount } = await supabase
        .from('user_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userEmail)
        .in('interaction_type', ['view', 'deep_dive'])

    const { count: dismissCount } = await supabase
        .from('user_interactions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userEmail)
        .eq('interaction_type', 'not_interested')

    return NextResponse.json({
        user_email: userEmail,
        user_vectors_row: vectorData || null,
        user_vectors_error: vecError?.message || null,
        vector_m3_info: vectorM3Info,
        rpc_check: vecCheck,
        interactions: {
            total: interactionCount,
            views: viewCount,
            dismissed: dismissCount,
        },
    })
}
