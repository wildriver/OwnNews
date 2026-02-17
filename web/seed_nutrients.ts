import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function seed() {
    console.log('Seeding sample nutrient scores for 100 articles...')
    
    // 最新100件を取得
    const { data: articles, error } = await supabase
        .from('articles')
        .select('id, title')
        .limit(100)
    
    if (error || !articles) {
        console.error('Error fetching articles:', error)
        return
    }

    let count = 0
    for (const article of articles) {
        const fact = Math.floor(Math.random() * 40) + 40
        const context = Math.floor(Math.random() * 60) + 20
        const perspective = Math.floor(Math.random() * 50) + 10
        const emotion = Math.floor(Math.random() * 60) + 20
        const immediacy = Math.floor(Math.random() * 50) + 40

        await supabase
            .from('articles')
            .update({
                fact_score: fact,
                context_score: context,
                perspective_score: perspective,
                emotion_score: emotion,
                immediacy_score: immediacy
            })
            .eq('id', article.id)
        
        count++
        if (count % 10 === 0) console.log(`Updated ${count} articles...`)
    }
    console.log('Done!')
}

seed()
