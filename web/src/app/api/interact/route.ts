import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const runtime = 'edge'

export async function POST(req: Request) {
    const supabase = await createClient()

    const {
        data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { articleId, type } = await req.json()

        if (!articleId || !type) {
            return NextResponse.json({ error: 'Missing articleId or type' }, { status: 400 })
        }

        const { error } = await supabase
            .from('user_interactions')
            .upsert(
                {
                    user_id: user.email,
                    article_id: articleId,
                    interaction_type: type,
                },
                { onConflict: 'user_id, article_id, interaction_type' }
            )

        if (error) {
            console.error('Interaction log error:', error)
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (e) {
        console.error('API Error:', e)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
