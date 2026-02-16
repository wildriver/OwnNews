'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateFilterStrength(value: number) {
    const supabase = await createClient()

    try {
        const {
            data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'User not authenticated' }
        }

        const userEmail = user.email
        if (!userEmail) {
            return { success: false, error: 'User email not found' }
        }

        // 1. Update user profile
        const { error: profileError } = await supabase
            .from('user_profile')
            .update({ filter_strength: value })
            .eq('user_id', userEmail)

        if (profileError) {
            console.error('Error updating profile:', profileError)
        }

        // 2. Insert into history
        const { error: historyError } = await supabase.from('filter_history').insert({
            user_id: userEmail,
            filter_strength: value,
        })

        if (historyError) {
            console.error('Error inserting history:', historyError)
            // Don't throw here either
        }

        revalidatePath('/')
        return { success: true }
    } catch (error) {
        console.error('Unexpected error in updateFilterStrength:', error)
        return { success: false, error: 'Internal server error' }
    }
}

export async function updateGroupingThreshold(value: number) {
    const supabase = await createClient()

    try {
        const {
            data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
            return { success: false, error: 'User not authenticated' }
        }

        const userEmail = user.email
        if (!userEmail) {
            return { success: false, error: 'User email not found' }
        }

        const { error } = await supabase
            .from('user_profile')
            .update({ grouping_threshold: value })
            .eq('user_id', userEmail)

        if (error) {
            console.error('Error updating grouping threshold:', error)
            return { success: false, error: 'Database update failed' }
        }

        revalidatePath('/')
        return { success: true }
    } catch (error) {
        console.error('Unexpected error in updateGroupingThreshold:', error)
        return { success: false, error: 'Internal server error' }
    }
}
