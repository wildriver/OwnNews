import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendPush, VapidConfig } from './webpush'

export interface Env {
    SUPABASE_URL: string
    SUPABASE_KEY: string
    AI: any
    /** 記事パック配信用R2バケット（wrangler.toml の r2_buckets 参照） */
    PACK_BUCKET?: R2Bucket
    /** Workers AI が失敗/枯渇した際のスコアリング用フォールバック（任意） */
    GROQ_API_KEY?: string
    /** Web Push (VAPID)。設定時のみ日次プッシュを送る */
    VAPID_PUBLIC_KEY?: string
    VAPID_PRIVATE_KEY?: string
    VAPID_SUBJECT?: string   // 例: mailto:you@example.com
}

/** 1日1回だけ、購読者全員に「新着ニュース」プッシュを送る。
 *  R2に日付マーカーを置き、その日すでに送っていれば何もしない。 */
async function sendDailyPushOnce(env: Env, supabase: SupabaseClient): Promise<void> {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.PACK_BUCKET) return

    const today = new Date().toISOString().split('T')[0]
    const marker = await env.PACK_BUCKET.get('push/last-sent.txt')
    if (marker && (await marker.text()).trim() === today) return  // 本日送信済み

    // 先にマーカーを置く（多重送信の窓を最小化）
    await env.PACK_BUCKET.put('push/last-sent.txt', today)

    const { data: subs, error } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
    if (error || !subs || subs.length === 0) {
        console.log('No push subscriptions.')
        return
    }

    const vapid: VapidConfig = {
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
        subject: env.VAPID_SUBJECT || 'mailto:admin@ownnews.example',
    }
    const nowSec = Math.floor(Date.now() / 1000)

    let ok = 0
    const expired: string[] = []
    for (const s of subs) {
        const r = await sendPush(s, vapid, nowSec)
        if (r === 'ok') ok++
        else if (r === 'gone') expired.push(s.endpoint)
    }
    // 失効した購読を掃除
    if (expired.length > 0) {
        await supabase.from('push_subscriptions').delete().in('endpoint', expired)
    }
    console.log(`Daily push: sent=${ok}, expired=${expired.length}, total=${subs.length}`)
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

/** RSS summaryのHTMLタグ・エンティティを除去してプレーンテキスト化する（web側 stripHtml と対） */
function stripHtml(input: string): string {
    if (!input) return ''
    return input
        .replace(/<[^>]*>/g, ' ')          // 完結したタグ
        .replace(/<[^>]*$/g, '')             // 末尾の未完タグ（300文字切りで途中で切れた分）
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&hellip;/gi, '…')
        .replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ')
        .trim()
}

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
    ${JSON.stringify(articles.map(a => ({ id: a.id, title: a.title, summary: stripHtml(a.summary || '').slice(0, 300) })), null, 2)}

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
    // 旧 @cf/meta/llama-3.1-8b-instruct は 2026-05-30 に廃止。現行のfp8版に差し替え。
    const chatResponse = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
        messages: [
            { role: 'system', content: 'You are a precise JSON output machine.' },
            { role: 'user', content: buildAnalysisPrompt(articles) }
        ],
        // 明示しないと出力が既定上限で途中切れし、JSON配列が壊れて解析失敗する
        max_tokens: 2048,
    })
    return parseAnalysisResponse(chatResponse?.response)
}

/**
 * 記事群を小さいサブバッチに分けて分析する。
 * 8Bの小型モデルは長い構造化出力（50件のJSON配列など）を安定して返せないため、
 * 8件ずつに分割して解析成功率を上げる。チャンク単位で Workers AI → Groq フォールバック。
 * 1チャンク失敗しても他チャンクには影響しない。
 */
const ANALYSIS_SUBBATCH = 8

async function analyzeArticles(env: Env, articles: Article[]): Promise<Record<string, CategorizationResult>> {
    const result: Record<string, CategorizationResult> = {}
    for (let i = 0; i < articles.length; i += ANALYSIS_SUBBATCH) {
        const chunk = articles.slice(i, i + ANALYSIS_SUBBATCH)
        let map: Record<string, CategorizationResult> = {}
        try {
            map = await analyzeWithWorkersAI(env, chunk)
            if (Object.keys(map).length === 0) throw new Error('Workers AI returned no parseable results')
        } catch (e) {
            console.error(`Workers AI analysis failed for chunk ${i / ANALYSIS_SUBBATCH}:`, e)
            if (env.GROQ_API_KEY) {
                try {
                    map = await analyzeWithGroq(env.GROQ_API_KEY, chunk)
                } catch (ge) {
                    console.error('Groq fallback also failed:', ge)
                }
            }
        }
        Object.assign(result, map)
    }
    return result
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
            // 8件チャンク分の出力に十分。大きすぎるとGroq無料枠で413になる
            max_tokens: 1500,
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

    // ソーシャルシグナル（全ユーザーの閲覧数・リアクション集計）を焼き込む。
    // クライアントの「バブルの外」が「自分以外の人がよく読む・反応が多い記事」を
    // 優先できるようにする（世間の窓）。失敗してもパック生成は続行。
    const socialMap = new Map<string, { views: number; reactions: Record<string, number> }>()
    try {
        const { data: social, error: sErr } = await supabase.rpc('article_social_counts')
        if (sErr) throw sErr
        for (const s of (social || []) as { article_id: string; views: number; reactions: Record<string, number> }[]) {
            socialMap.set(s.article_id, { views: Number(s.views) || 0, reactions: s.reactions || {} })
        }
    } catch (e) {
        console.warn('social counts unavailable (run migration?):', e)
    }

    let latest = ''
    const articles = (data || []).map((a) => {
        const vec = parseVector(a.embedding_m3)
        if (a.collected_at > latest) latest = a.collected_at
        const social = socialMap.get(a.id)
        return {
            // 0件のフィールドは省略してパックサイズを抑える
            ...(social && social.views > 0 ? { views: social.views } : {}),
            ...(social && Object.keys(social.reactions).length > 0 ? { reactions: social.reactions } : {}),
            id: a.id,
            title: a.title,
            link: a.link,
            // 公開パックに含める抜粋はごく短く（軽微利用）。解析用の内部利用とは別
            summary: stripHtml(a.summary || '').slice(0, 120),
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

            // 3. Categorize & Analyze Nutrients（8件ずつのサブバッチ、失敗時Groq）
            const categoryMap = await analyzeArticles(env, articles)

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

        // 3.5 栄養素バックフィル: 埋め込みはあるが栄養素が未生成の記事を分析する。
        //     （新規記事の埋め込み処理とは別に、過去の解析失敗分を毎回32件ずつ埋めていく）
        try {
            const { data: needScore } = await supabase
                .from('articles')
                .select('id, title, link, summary, category_medium, category_minor')
                .not('embedding_m3', 'is', null)
                .is('fact_score', null)
                .order('collected_at', { ascending: false })
                .limit(32)

            if (needScore && needScore.length > 0) {
                console.log(`Backfilling nutrients for ${needScore.length} articles...`)
                const map = await analyzeArticles(env, needScore as Article[])
                const rows = needScore
                    .filter(a => map[a.id])
                    .map(a => {
                        const c = map[a.id]
                        return {
                            id: a.id,
                            title: a.title,   // NOT NULL列。upsertのINSERT節を満たすため必須
                            link: a.link,     // NOT NULL列
                            category_medium: c.category_medium || a.category_medium,
                            category_minor: c.category_minor || a.category_minor,
                            fact_score: c.fact_score ?? null,
                            context_score: c.context_score ?? null,
                            perspective_score: c.perspective_score ?? null,
                            emotion_score: c.emotion_score ?? null,
                            immediacy_score: c.immediacy_score ?? null,
                        }
                    })
                if (rows.length > 0) {
                    const { error: bfError } = await supabase.from('articles').upsert(rows, { onConflict: 'id' })
                    if (bfError) console.error('Backfill update error:', bfError)
                    else {
                        processedCount += rows.length
                        console.log(`Backfilled nutrients for ${rows.length} articles.`)
                    }
                }
            }
        } catch (e) {
            console.error('Nutrient backfill error:', e)
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

        // 6. 日次プッシュ通知（JST朝の窓 = UTC21-23時台のcronでのみ、1日1回）
        //    event.cron が朝枠のときだけ実行。R2の日付マーカーで多重送信を防ぐ。
        if (event.cron === '*/10 21,22 * * *') {
            ctx.waitUntil(sendDailyPushOnce(env, supabase))
        }
    }
}
