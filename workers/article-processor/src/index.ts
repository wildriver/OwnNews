import { createClient, SupabaseClient } from '@supabase/supabase-js'

export interface Env {
    SUPABASE_URL: string
    SUPABASE_KEY: string
    AI: any
    /** 記事パック配信用R2バケット（wrangler.toml の r2_buckets 参照） */
    PACK_BUCKET?: R2Bucket
    /** Workers AI が失敗/枯渇した際のスコアリング用フォールバック（任意） */
    GROQ_API_KEY?: string
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

/** パックに含める記事数（直近） */
const PACK_SIZE = 800

/** Secretsに入力されたURLの揺れ（スキーム欠落・前後空白・末尾スラッシュ）を吸収する */
function normalizeSupabaseUrl(raw: string): string {
    let u = (raw || '').trim().replace(/\/+$/, '')
    if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u
    return u
}

// ============================================================
// LLM分析（分類 + 栄養素スコア）
// ============================================================

function buildAnalysisPrompt(articles: Article[]): string {
    return `
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
    ${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, summary: (a.summary || '').slice(0, 300) })), null, 2)}

    Instructions:
    1. Analyze each article title and summary.
    2. Assign a "Medium Category" and "Minor Keywords".
    3. Score each nutrient (0-100) as an integer.
    4. Output strictly a JSON list of objects.
    5. JSON format: [{"id": "...", "category_medium": "...", "category_minor": ["..."], "fact_score": 50, "context_score": 50, "perspective_score": 50, "emotion_score": 50, "immediacy_score": 50}]

    Output strictly valid JSON. No markdown.
    `
}

function parseAnalysisResponse(raw: unknown): Record<string, CategorizationResult> {
    const map: Record<string, CategorizationResult> = {}
    if (typeof raw !== 'string') return map
    let jsonStr = raw.replace(/```json/g, '').replace(/```/g, '').trim()
    const start = jsonStr.indexOf('[')
    const end = jsonStr.lastIndexOf(']')
    if (start >= 0 && end >= 0) {
        jsonStr = jsonStr.substring(start, end + 1)
    }
    try {
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed)) {
            parsed.forEach((item: any) => {
                if (item.id) map[item.id] = item
            })
        }
    } catch (parseError) {
        console.error('JSON Parse Error:', parseError, 'Raw:', jsonStr.slice(0, 500))
    }
    return map
}

async function analyzeWithWorkersAI(env: Env, articles: Article[]): Promise<Record<string, CategorizationResult>> {
    const chatResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
            { role: 'system', content: 'You are a precise JSON output machine.' },
            { role: 'user', content: buildAnalysisPrompt(articles) }
        ]
    })
    return parseAnalysisResponse(chatResponse?.response)
}

/** Workers AI のNeurons枯渇・障害時のフォールバック（Groq無料枠） */
async function analyzeWithGroq(apiKey: string, articles: Article[]): Promise<Record<string, CategorizationResult>> {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: 'You are a precise JSON output machine.' },
                { role: 'user', content: buildAnalysisPrompt(articles) }
            ],
            temperature: 0.1,
            max_tokens: 4096,
        }),
    })
    if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}`)
    const data: any = await resp.json()
    return parseAnalysisResponse(data?.choices?.[0]?.message?.content)
}

// ============================================================
// 記事パック生成（int8量子化埋め込み → R2）
// ============================================================

function parseVector(v: unknown): number[] | null {
    if (!v) return null
    if (typeof v === 'string') {
        try { return JSON.parse(v) } catch { return null }
    }
    if (Array.isArray(v)) return v as number[]
    return null
}

/** L2正規化してint8量子化 → base64（web側 decodeEmb と対になる） */
function quantizeToBase64(vec: number[]): string | null {
    const n = vec.length
    if (n === 0) return null
    let norm = 0
    for (let i = 0; i < n; i++) norm += vec[i] * vec[i]
    norm = Math.sqrt(norm)
    if (norm === 0) return null

    const bytes = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
        const q = Math.max(-127, Math.min(127, Math.round((vec[i] / norm) * 127)))
        bytes[i] = q & 0xff
    }
    let binary = ''
    const CHUNK = 8192
    for (let i = 0; i < n; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
}

async function generateAndUploadPack(supabase: SupabaseClient, bucket: R2Bucket): Promise<void> {
    const { data, error } = await supabase
        .from('articles')
        .select('id, title, link, summary, published, category, category_medium, category_minor, image_url, source, fact_score, context_score, perspective_score, emotion_score, immediacy_score, collected_at, embedding_m3')
        .not('embedding_m3', 'is', null)
        .order('collected_at', { ascending: false })
        .limit(PACK_SIZE)

    if (error) {
        console.error('Pack query error:', error)
        return
    }

    let latest = ''
    const articles = (data || []).map((a) => {
        const vec = parseVector(a.embedding_m3)
        if (a.collected_at > latest) latest = a.collected_at
        return {
            id: a.id,
            title: a.title,
            link: a.link,
            summary: (a.summary || '').slice(0, 300),
            published: a.published,
            category: a.category,
            category_medium: a.category_medium,
            category_minor: a.category_minor,
            image_url: a.image_url,
            source: a.source,
            fact_score: a.fact_score,
            context_score: a.context_score,
            perspective_score: a.perspective_score,
            emotion_score: a.emotion_score,
            immediacy_score: a.immediacy_score,
            collected_at: a.collected_at,
            emb: vec ? quantizeToBase64(vec) : null,
        }
    })

    const pack = JSON.stringify({
        dim: 1024,
        count: articles.length,
        generated_at: new Date().toISOString(),
        latest,
        articles,
    })

    await bucket.put('pack/latest.json', pack, {
        httpMetadata: {
            contentType: 'application/json',
            cacheControl: 'public, max-age=600',
        },
    })
    console.log(`Pack uploaded: ${articles.length} articles, ${(pack.length / 1024).toFixed(0)} KB`)

    // 研究用の日次スナップショット（その日の最初の実行のみ）
    const today = new Date().toISOString().split('T')[0]
    const snapshotKey = `pack/daily/${today}.json`
    const existing = await bucket.head(snapshotKey)
    if (!existing) {
        await bucket.put(snapshotKey, pack, {
            httpMetadata: { contentType: 'application/json' },
        })
        console.log(`Daily snapshot saved: ${snapshotKey}`)
    }
}

// ============================================================
// メイン: 未処理記事の埋め込み+分析 → パック更新
// ============================================================

export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
        console.log('Worker started processing...')

        const supabaseUrl = normalizeSupabaseUrl(env.SUPABASE_URL)
        if (!supabaseUrl || !env.SUPABASE_KEY) {
            console.error('Missing Supabase credentials')
            return
        }

        const supabase = createClient(supabaseUrl, (env.SUPABASE_KEY || '').trim())

        // 1. Fetch unprocessed articles (limit 50)
        const { data: articles, error } = await supabase
            .from('articles')
            .select('*')
            .is('embedding_m3', null)
            .order('collected_at', { ascending: false })
            .limit(50)

        if (error) {
            console.error('Supabase fetch error:', error)
            return
        }

        let processedCount = 0

        if (articles && articles.length > 0) {
            console.log(`Processing ${articles.length} articles...`)

            // 2. Generate Embeddings (BGE-M3)
            const texts = articles.map(a => `${a.title} ${a.summary || ''}`.trim())
            let embeddings: number[][] = []
            try {
                const embeddingResponse = await env.AI.run('@cf/baai/bge-m3', { text: texts })
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

            // 3. Categorize & Analyze Nutrients (Workers AI → 失敗時はGroqフォールバック)
            let categoryMap: Record<string, CategorizationResult> = {}
            try {
                categoryMap = await analyzeWithWorkersAI(env, articles)
                if (Object.keys(categoryMap).length === 0) {
                    throw new Error('Workers AI returned no parseable results')
                }
            } catch (e) {
                console.error('Workers AI analysis failed:', e)
                if (env.GROQ_API_KEY) {
                    try {
                        console.log('Falling back to Groq for analysis...')
                        categoryMap = await analyzeWithGroq(env.GROQ_API_KEY, articles)
                    } catch (ge) {
                        console.error('Groq fallback also failed:', ge)
                        // 埋め込みだけでも保存する（分析は次回以降のバックフィルに委ねる）
                    }
                }
            }

            // 4. Update Supabase
            const updates = articles.map((a, index) => {
                const catData = categoryMap[a.id] || {}
                return {
                    ...a, // Spread all existing fields
                    embedding_m3: embeddings[index],
                    category_medium: catData.category_medium || a.category_medium,
                    category_minor: catData.category_minor || a.category_minor,
                    // LLM応答に含まれなかった記事は既存スコアを保持する（nullで上書きしない）
                    fact_score: catData.fact_score ?? a.fact_score ?? null,
                    context_score: catData.context_score ?? a.context_score ?? null,
                    perspective_score: catData.perspective_score ?? a.perspective_score ?? null,
                    emotion_score: catData.emotion_score ?? a.emotion_score ?? null,
                    immediacy_score: catData.immediacy_score ?? a.immediacy_score ?? null,
                }
            })

            const { error: updateError } = await supabase
                .from('articles')
                .upsert(updates, { onConflict: 'id' })

            if (updateError) {
                console.error('Bulk update error:', updateError)
            } else {
                processedCount = updates.length
                console.log(`Successfully updated ${updates.length} articles.`)
            }
        } else {
            console.log('No articles to process.')
        }

        // 5. パック生成 → R2
        //    新規処理があったとき、または latest.json が未生成のときに更新する
        if (env.PACK_BUCKET) {
            const needsPack = processedCount > 0 || !(await env.PACK_BUCKET.head('pack/latest.json'))
            if (needsPack) {
                ctx.waitUntil(generateAndUploadPack(supabase, env.PACK_BUCKET))
            } else {
                console.log('Pack is up to date, skipping upload.')
            }
        } else {
            console.warn('PACK_BUCKET binding not configured — pack generation skipped.')
        }
    }
}
