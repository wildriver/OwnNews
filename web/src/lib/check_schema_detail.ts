
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function checkSchemaDetail() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    console.log('--- Checking Column Types for user_profile and filter_history ---')

    // We can't easily get column types via JS client without a custom RPC or direct Postgres access.
    // However, we can try to insert a UUID into user_id and see if it errors.

    const { error: pError } = await supabase
        .from('user_profile')
        .select('*')
        .limit(1)

    if (pError) console.error('Error fetching profile:', pError)

    const { data: historyData, error: hError } = await supabase
        .from('filter_history')
        .select('*')
        .limit(1)

    if (hError) {
        console.error('Error fetching history:', hError.message)
    } else {
        console.log('History table structure seems OK.')
    }
}

checkSchemaDetail()
