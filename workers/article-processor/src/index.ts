
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
    fact_score: number
    context_score: number
    perspective_score: number
    emotion_score: number
    immediacy_score: number
}

// ... (existing code) ...



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

        // 3. Categorize & Analyze Nutrients (Llama 3)
        // Construct a specific prompt for batch categorization and nutrient scoring
        const prompt = `
    You are a professional news analyst. 
    Analyze the following news articles to:
    1. Classify them into a "Medium Category".
    2. Extract "Minor Keywords".
    3. Calculate "Nutrient Scores" (0-100) based on the 5 elements of news.

    Allowed Medium Categories: 政治, 経済, 国際, IT・テクノロジー, スポーツ, エンタメ, 科学, 社会, 地方, ビジネス, 生活, 環境, 文化, その他.
    
    Nutrient Definitions:
    - fact_score (Protein): Base on objective data, 5W1H transparency. High: Detailed stats/facts. Low: Vague rumors.
    - context_score (Carbohydrate): Base on background info, history, "Why". High: Deep dive/Analysis. Low: Just what happened.
    - perspective_score (Vit/Min): Base on multi-viewpoints. High: Pros/Cons, diverse opinions. Low: Single-sided.
    - emotion_score (Fat): Base on emotional hook/drama. High: Heartwarming/Shocking. Low: Dry reporting.
    - immediacy_score (Water): Base on freshness/urgency. High: Breaking news/Live. Low: Evergreen/History.
    
    Input Articles:
    ${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, summary: a.summary })), null, 2)}
    
    Instructions:
    1. Analyze each article title and summary.
    2. Assign a "Medium Category" and "Minor Keywords".
    3. Score each nutrient (0-100) as an integer.
    4. Output strictly a JSON list of objects.
    5. JSON format: [{"id": "...", "category_medium": "...", "category_minor": ["..."], "fact_score": 50, "context_score": 50, "perspective_score": 50, "emotion_score": 50, "immediacy_score": 50}]
    
    Output strictly valid JSON. No markdown.
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
                fact_score: catData.fact_score ?? null,
                context_score: catData.context_score ?? null,
                perspective_score: catData.perspective_score ?? null,
                emotion_score: catData.emotion_score ?? null,
                immediacy_score: catData.immediacy_score ?? null,
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
