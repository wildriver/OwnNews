
import { createClient } from '@supabase/supabase-js'

export interface Env {
    SUPABASE_URL: string
    SUPABASE_KEY: string
    AI: any
}

interface Article {
    id: string
    title: string
    summary: string
    category?: string
    [key: string]: any // Allow other properties
}

interface CategorizationResult {
    id: string
    category_medium: string
    category_minor: string[]
}

export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        console.log('Worker started processing...')

        if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
            console.error('Missing Supabase credentials')
            return
        }

        const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY)

        // 1. Fetch unprocessed articles (limit 50)
        // We check for null embedding_m3
        // Fetch ALL columns to satisfy upsert constraints (NOT NULL columns must be present)
        const { data: articles, error } = await supabase
            .from('articles')
            .select('*')
            .is('embedding_m3', null)
            .limit(50)

        if (error) {
            console.error('Supabase fetch error:', error)
            return
        }

        if (!articles || articles.length === 0) {
            console.log('No articles to process.')
            return
        }

        console.log(`Processing ${articles.length} articles...`)

        // 2. Generate Embeddings (BGE-M3)
        const texts = articles.map(a => `${a.title} ${a.summary || ''}`.trim())
        let embeddings: number[][] = []

        try {
            // Cloudflare AI's BGE-M3 model input expects { text: string | string[] }
            const embeddingResponse = await env.AI.run('@cf/baai/bge-m3', {
                text: texts
            })
            // Response format: { shape: [N, 1024], data: number[][] }
            if (embeddingResponse && embeddingResponse.data) {
                embeddings = embeddingResponse.data
            } else {
                throw new Error('Invalid embedding response format')
            }
        } catch (e) {
            console.error('Embedding generation error:', e)
            return
        }

        if (embeddings.length !== articles.length) {
            console.error(`Embedding count mismatch: got ${embeddings.length}, expected ${articles.length}`)
            return
        }

        // 3. Categorize (Llama 3)
        // Construct a specific prompt for batch categorization
        const prompt = `
    You are a news categorization AI. 
    Classify the following news articles into a "Medium Category" and extract "Minor Keywords".
    
    Allowed Medium Categories: 政治, 経済, 国際, IT・テクノロジー, スポーツ, エンタメ, 科学, 社会, 地方, ビジネス, 生活, 環境, 文化, その他.
    
    Input Articles:
    ${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title })), null, 2)}
    
    Instructions:
    1. Analyze each article title.
    2. Assign a "Medium Category" from the allowed list.
    3. Extract 2-5 "Minor Keywords" (important nouns).
    4. Output strictly a JSON list of objects.
    5. JSON format: [{"id": "...", "category_medium": "...", "category_minor": ["...", "..."]}]
    
    Output strictly valid JSON. No markdown, no "Here is the JSON".
    `

        let categoryMap: Record<string, CategorizationResult> = {}
        try {
            const chatResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                messages: [
                    { role: 'system', content: 'You are a precise JSON output machine.' },
                    { role: 'user', content: prompt }
                ]
            })

            let jsonStr = chatResponse.response
            // Attempt to clean up markdown if present
            if (typeof jsonStr === 'string') {
                jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim()
                const start = jsonStr.indexOf('[')
                const end = jsonStr.lastIndexOf(']')
                if (start >= 0 && end >= 0) {
                    jsonStr = jsonStr.substring(start, end + 1)
                }

                try {
                    const parsed = JSON.parse(jsonStr)
                    if (Array.isArray(parsed)) {
                        parsed.forEach((item: any) => {
                            if (item.id) categoryMap[item.id] = item
                        })
                    }
                } catch (parseError) {
                    console.error('JSON Parse Error:', parseError, 'Raw:', jsonStr)
                }
            }
        } catch (e) {
            console.error('Categorization error:', e)
            // We continue with just embeddings if categorization fails
        }

        // 4. Update Supabase
        // We match by ID. onConflict='id' will perform UPDATE if ID exists.
        // By providing all columns (from select *), we satisfy any NOT NULL constraints for the "INSERT" part of upsert.
        // We intentionally overwrite embedding_m3 and categories.

        const updates = articles.map((a, index) => {
            const catData = categoryMap[a.id] || {}
            return {
                ...a, // Spread all existing fields
                embedding_m3: embeddings[index],
                category_medium: catData.category_medium || a.category_medium, // Prefer new, fallback to old
                category_minor: catData.category_minor || a.category_minor,
                // Remove updated_at if it's in `a`? Supabase might handle it automatically or we might be sending old value.
                // If we send old updated_at, it's fine. It's metadata. 
                // If we want to update it, we can set it to new Date(). 
                // But if the column doesn't exist, we should NOT include it.
                // `a` comes from `select('*')`, so it only contains existing columns.
                // If `updated_at` was not in `a`, `...a` won't have it.
                // If we explicitly add it, we might error if column missing.
                // Safest is to NOT add it explicitly.
            }
        })

        const { error: updateError } = await supabase
            .from('articles')
            .upsert(updates, { onConflict: 'id' })

        if (updateError) {
            console.error('Bulk update error:', updateError)
        } else {
            console.log(`Successfully updated ${updates.length} articles.`)
        }
    }
}
