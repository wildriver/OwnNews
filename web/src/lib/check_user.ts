
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function checkUser() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    console.log('--- All User Profiles ---')
    const { data: profiles, error } = await supabase
        .from('user_profile')
        .select('*')
        .limit(10)

    if (error) {
        console.error('Error:', error)
    } else {
        console.log('Profiles:', profiles)
    }
}

checkUser()
