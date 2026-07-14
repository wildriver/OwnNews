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
    /** さくらのAI Engine（無償3,000req/月）。設定時は解析の主力になる */
    SAKURA_API_KEY?: string
    /** さくらで使うモデル（wrangler.tomlのvarsで切替可。既定: gpt-oss-120b） */
    SAKURA_MODEL?: string
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

/** 1回の実行で埋め込みを生成する最大件数。
 *  記事はパックに載るのに埋め込みだけを必要とするため、ここがニュースの表示速度を決める。
 *  以前は50件（＝時速100件）しかなく、1回の収集で1000件超入るとフィードが数時間遅れた。
 *  BGE-M3は安価・高速なので大きく回す（EMBED_CHUNK件ずつAIに投げる）。 */
const EMBED_LIMIT = 400
const EMBED_CHUNK = 50

/** 1回の実行でLLM解析（栄養素・中分類・キーワード）する最大件数。
 *  解析が遅れてもニュース表示は止まらないが、遅すぎると話題キーワードや
 *  栄養素スコアが空のままになるため、バーストに追随できる量を確保する
 *  （48件 × 48実行/日 = 日次2,300件）。 */
const ANALYZE_LIMIT = 48

/** そのうち「さくら」を使ってよいサブバッチ数（1実行あたり）。
 *  さくらの無料枠は月3,000リクエストなので使い切らないよう固定する:
 *  2バッチ/回 × 48実行/日 ≒ 96req/日 ≒ 2,880req/月 → 枠内。
 *  これを超えるバッチは さくらを飛ばして Groq（無料・大容量）へ直接回す。 */
const SAKURA_BATCHES_PER_RUN = 2

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

/** 中分類の許可リスト（プロンプトで指定している14分類）。リスト外の幻覚出力を遮断する。 */
const ALLOWED_MEDIUM = new Set(['政治', '経済', '国際', 'IT・テクノロジー', 'スポーツ', 'エンタメ', '科学', '社会', '地方', 'ビジネス', '生活', '環境', '文化', 'その他'])

/**
 * LLM出力の検証・浄化。
 * 小型モデルで「本杰」「岛室」のような中国語混じりの分類名や、
 * 記事に存在しない幻覚キーワードが混入したため、機械的に検証する。
 * - 中分類: 許可リスト外 → 「その他」
 * - キーワード: 記事のタイトル+概要に実際に出現する語だけ通す（抽出制約）
 * - スコア: 0-100の整数にクランプ
 */
function sanitizeAnalysis(article: Article, res: CategorizationResult): CategorizationResult {
    const text = `${article.title} ${stripHtml(article.summary || '')}`
    const medium = ALLOWED_MEDIUM.has((res.category_medium || '').trim())
        ? (res.category_medium || '').trim() : 'その他'
    const minor = (Array.isArray(res.category_minor) ? res.category_minor : [])
        .map(k => String(k).trim())
        .filter(k => k.length >= 2 && k.length <= 12 && text.includes(k))
        .slice(0, 5)
    const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)))
    return {
        id: res.id, category_medium: medium, category_minor: minor,
        fact_score: clamp(res.fact_score), context_score: clamp(res.context_score),
        perspective_score: clamp(res.perspective_score), emotion_score: clamp(res.emotion_score),
        immediacy_score: clamp(res.immediacy_score),
    }
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
/** さくら（120B・リクエスト数制）使用時のサブバッチ。大型モデルは長い構造化出力に耐えるので
 *  大きめにして月3,000リクエスト枠を節約する。JSON解析失敗が増えるようなら12→8に戻す。 */
const ANALYSIS_SUBBATCH_SAKURA = 12

/**
 * @param sakuraBatchBudget この呼び出しでさくらを使ってよいサブバッチ数。
 *   さくらは無料枠が「月3,000リクエスト」なので、1実行あたりの使用数を固定して
 *   温存する（2バッチ/回 × 48実行/日 ≒ 96req/日 ≒ 2,880req/月 で枠内）。
 *   これを超えるぶんは さくらを飛ばして Groq（無料・大容量）へ直接回すことで、
 *   さくらを使い切らずに解析スループットだけを上げられる。
 */
async function analyzeArticles(
    env: Env,
    articles: Article[],
    sakuraBatchBudget: number = Number.POSITIVE_INFINITY,
): Promise<Record<string, CategorizationResult>> {
    const result: Record<string, CategorizationResult> = {}
    const subbatch = env.SAKURA_API_KEY ? ANALYSIS_SUBBATCH_SAKURA : ANALYSIS_SUBBATCH
    for (let i = 0; i < articles.length; i += subbatch) {
        const chunk = articles.slice(i, i + subbatch)
        const batchIndex = i / subbatch
        // さくら枠を使い切ったバッチは、さくらを試さずGroqへ直行する（枠の温存）
        const useSakura = !!env.SAKURA_API_KEY && batchIndex < sakuraBatchBudget
        let map: Record<string, CategorizationResult> = {}
        // 解析チェーン: さくら gpt-oss-120b（主力・枠内のバッチのみ）
        //   → Groq 70B → Workers AI 8B。どの段でも同じ検証フィルタが効く。
        try {
            if (!useSakura) throw new Error('sakura skipped (budget preserved)')
            map = await analyzeWithSakura(env.SAKURA_API_KEY!, env.SAKURA_MODEL || 'gpt-oss-120b', chunk)
            if (Object.keys(map).length === 0) throw new Error('Sakura returned no parseable results')
        } catch (se) {
            if (useSakura) console.error(`Sakura analysis failed for chunk ${i / subbatch}:`, se)
            try {
                if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set')
                map = await analyzeWithGroq(env.GROQ_API_KEY, chunk)
                if (Object.keys(map).length === 0) throw new Error('Groq returned no parseable results')
            } catch (e) {
                console.error(`Groq(70B) analysis failed for chunk ${i / subbatch}:`, e)
                try {
                    map = await analyzeWithWorkersAI(env, chunk)
                } catch (ge) {
                    console.error('Workers AI fallback also failed:', ge)
                }
            }
        }
        // 記事本文と突き合わせて検証してから採用
        for (const a of chunk) {
            const r = map[a.id]
            if (r) result[a.id] = sanitizeAnalysis(a, r)
        }
    }
    return result
}

/** さくらのAI Engine（OpenAI互換・無償3,000req/月）。
 *  リクエスト数課金なのでバッチを大きめ(12件)にして枠を節約する。 */
async function analyzeWithSakura(apiKey: string, model: string, articles: Article[]): Promise<Record<string, CategorizationResult>> {
    const resp = await fetch('https://api.ai.sakura.ad.jp/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: 'You are a precise JSON output machine.' },
                { role: 'user', content: buildAnalysisPrompt(articles) },
            ],
            max_tokens: 4096,
            temperature: 0.2,
        }),
    })
    if (!resp.ok) throw new Error(`Sakura API ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
    const data = await resp.json() as { choices?: { message?: { content?: string } }[] }
    return parseAnalysisResponse(data?.choices?.[0]?.message?.content)
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
            model: 'llama-3.3-70b-versatile',
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

// ---- 話題のキーワード（パックに焼き込む全ユーザー共通の集計） ----
// パックは直近800件≒ほぼ1日分しか持たないため、「平常時」との比較はDBを持つ
// Worker側でしかできない。TF-IDFと同じ発想:
//   スコア = リフト（直近24時間の出現率 ÷ 過去7日の平常時出現率）
//          × 注目度（その語を含む直近記事の閲覧数+リアクション×3、対数）
// 毎日一定量出る語（訃報・株価など）はリフト≒1倍になるため2倍未満を足切りする。

const HOT_WINDOW_MS = 24 * 60 * 60 * 1000
const HOT_BASELINE_DAYS = 7
const HOT_MIN_LIFT = 2
const HOT_LIMIT = 12
const HOT_STOPWORDS = new Set([
    '日本', '東京', '米国', 'アメリカ', '中国', '韓国', '政府',
    '政治', '経済', '国際', '社会', 'IT', 'スポーツ', 'エンターテイメント', 'サイエンス',
    '訃報', '追悼', '死去', '人事',
    '事件', '事故', 'ニュース', '速報', '発表', '話題',
])

async function computeHotKeywords(
    supabase: SupabaseClient,
    packArticles: { id: string; collected_at: string; category_minor?: string[] | null }[],
    socialMap: Map<string, { views: number; reactions: Record<string, number> }>
): Promise<string[]> {
    let newestMs = 0
    for (const a of packArticles) {
        const t = Date.parse(a.collected_at || '')
        if (t > newestMs) newestMs = t
    }
    if (newestMs === 0) return []
    const cutoffIso = new Date(newestMs - HOT_WINDOW_MS).toISOString()
    const baseStartIso = new Date(newestMs - HOT_WINDOW_MS - HOT_BASELINE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const cutoffMs = newestMs - HOT_WINDOW_MS

    // 「今日」= パック記事のうち直近24時間（パックは常に最新側なのでこれで十分）
    let recentArts = 0
    const recentCount = new Map<string, number>()
    const attention = new Map<string, number>()
    for (const a of packArticles) {
        if (Date.parse(a.collected_at || '') < cutoffMs) continue
        recentArts++
        const social = socialMap.get(a.id)
        const attn = (social?.views || 0) +
            Object.values(social?.reactions || {}).reduce((s, n) => s + n, 0) * 3
        const tags = new Set((a.category_minor || []).filter(k => k.length >= 2 && !HOT_STOPWORDS.has(k)))
        for (const k of tags) {
            recentCount.set(k, (recentCount.get(k) || 0) + 1)
            attention.set(k, (attention.get(k) || 0) + 1 + Math.log1p(attn))
        }
    }
    if (recentArts === 0) return []

    // 「平常時」= その前7日分をDBからページングで取得（keywordsのみの軽い列）。
    // Cloudflare無料枠の50サブリクエスト上限を守るためページ数を絞る
    // （3ページ=最大3000件あればリフト計算のベースラインとして十分）。
    let baseArts = 0
    const baseCount = new Map<string, number>()
    for (let page = 0; page < 3; page++) {
        const { data, error } = await supabase
            .from('articles')
            .select('category_minor')
            .gte('collected_at', baseStartIso)
            .lt('collected_at', cutoffIso)
            .range(page * 1000, page * 1000 + 999)
        if (error) {
            console.warn('hot keywords baseline query failed:', error.message)
            break
        }
        if (!data || data.length === 0) break
        for (const a of data as { category_minor?: string[] | null }[]) {
            baseArts++
            const tags = new Set((a.category_minor || []).filter(k => k.length >= 2 && !HOT_STOPWORDS.has(k)))
            for (const k of tags) baseCount.set(k, (baseCount.get(k) || 0) + 1)
        }
        if (data.length < 1000) break
    }

    // 平常時サンプルが十分あるときだけリフト足切り（運用初期は頻度×注目度のみ）
    const canLift = baseArts >= 200
    const scored = [...recentCount.entries()]
        .filter(([, c]) => c >= 3)   // 3記事以上で言及されて初めて「話題」
        .map(([k, c]) => {
            const todayRate = c / recentArts
            const baseRate = ((baseCount.get(k) || 0) + 0.5) / Math.max(baseArts, 1)
            const lift = todayRate / baseRate
            return { k, lift, score: (canLift ? lift : 1) * (attention.get(k) || 1) }
        })
        .filter(({ lift }) => !canLift || lift >= HOT_MIN_LIFT)
        .sort((a, b) => b.score - a.score)

    // 「大谷翔平」と「大谷」のような包含関係の重複は高スコア側だけ残す
    const picked: string[] = []
    for (const { k } of scored) {
        if (picked.length >= HOT_LIMIT) break
        if (picked.some(p => p.includes(k) || k.includes(p))) continue
        picked.push(k)
    }
    console.log(`Hot keywords: recent=${recentArts} base=${baseArts} lift=${canLift} -> ${picked.join(', ')}`)
    return picked
}

/** メタデータ取得の時間スライス幅と最大遡り数（6時間×12=72時間分）。
 *  offsetページングはoffsetが深くなるほどインデックス歩行が伸び、テーブル肥大化した
 *  現状ではoffset400（3ページ目）で statement timeout になった（2026-07-13の障害）。
 *  collected_at の範囲指定ならインデックスレンジスキャンで、深さに関わらず一定コスト。 */
const PACK_META_SLICE_MS = 6 * 60 * 60 * 1000
const PACK_META_MAX_SLICES = 12
const PACK_META_COLUMNS = 'id, title, link, summary, published, category, category_medium, category_minor, image_url, source, fact_score, context_score, perspective_score, emotion_score, immediacy_score, collected_at'
/** 埋め込み取得の1文あたり件数。
 *  埋め込み列（1024次元×約15KB）はテーブル肥大化により、100件の一括読み出しでも
 *  Supabaseの statement timeout（57014）を超えるようになった（2026-07-13の障害）。
 *  そのため埋め込みは「旧パックに無い記事」だけを少数ずつ取得する。 */
const PACK_EMB_CHUNK = 20

// ---- 研究用アーカイブ + retention ----
// 記事原本はCEEK.JP NEWS側に存在するため、アプリのDBは直近分だけでよい。
// 研究用の全データはR2に日次JSONで退避してから、DBの古い行を削除する。
// （テーブル肥大化による statement timeout 障害（2026-07-13）の根本対策）

/** DBに残す日数。これより古い「JST日」を丸ごとアーカイブ→削除する。
 *  削除は collected_at の範囲指定による1文のDELETE（サブリクエスト1回）で行う。 */
const RETENTION_DAYS = 30
/** アーカイブ取得のページサイズ。PostgRESTは1リクエスト最大1000行に黙って切り詰める
 *  （これを知らず .limit(2000) で200件を取りこぼし削除した事故が2026-07-13にあった）ため、
 *  必ず1000未満のページでスライス内をページングする */
const ARCHIVE_PAGE = 500
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ISO時刻文字列 → JSTの日付（YYYY-MM-DD） */
function jstDayOf(iso: string): string {
    return new Date(Date.parse(iso) + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * 最古の「JST日」を1日分アーカイブしてDBから削除する（1実行あたり最大1日）。
 * cronは1日約30回走るので、過去の未整理分も数日で30日分まで縮む。
 * アーカイブ（R2書き込み）が確認できるまでは絶対に削除しない。
 */
async function archiveAndPruneOldest(supabase: SupabaseClient, bucket: R2Bucket): Promise<void> {
    const { data: oldest, error: oErr } = await supabase
        .from('articles')
        .select('collected_at')
        .order('collected_at', { ascending: true })
        .limit(1)
    if (oErr || !oldest || oldest.length === 0) return

    const day = jstDayOf(oldest[0].collected_at)
    const cutoffDay = jstDayOf(new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString())
    if (day >= cutoffDay) return   // 最古の日がまだ保持期間内

    const fromMs = Date.parse(`${day}T00:00:00+09:00`)
    const fromIso = new Date(fromMs).toISOString()
    const toIso = new Date(fromMs + 24 * 60 * 60 * 1000).toISOString()

    // 0. その日の正確な行数（削除前の完全性チェックの基準）
    const { count: dayCount, error: cErr } = await supabase
        .from('articles')
        .select('id', { count: 'exact', head: true })
        .gte('collected_at', fromIso)
        .lt('collected_at', toIso)
    if (cErr || dayCount == null) {
        console.error(`Archive count query error (${day}):`, cErr)
        return
    }
    if (dayCount === 0) return

    // 1. アーカイブ。既存アーカイブは「DBの現在の行を全件取れたか」で十分性を判定し、
    //    作り直すときも既存分と**和集合でマージ**する。
    //    - PostgRESTは1リクエスト最大1000行に切り詰めるため、.limit(2000)が
    //      黙って欠けるバグがあった（スライス内でもページングして全件取る）
    //    - 部分削除済みの日を上書きで作り直すと、削除済み分がアーカイブから
    //      消えてしまうため、上書きではなく必ずマージする
    const key = `archive/daily/${day}.json`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged = new Map<string, any>()
    try {
        const existing = await bucket.get(key)
        if (existing) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parsed = JSON.parse(await existing.text()) as { articles?: any[] }
            for (const a of parsed.articles || []) if (a?.id) merged.set(a.id, a)
        }
    } catch (e) {
        console.warn(`Archive read failed for ${day} (will rebuild):`, e)
    }

    // 既存アーカイブの件数が合っていても中身の照合はできない（部分削除と偶然一致しうる）
    // ため、削除前は毎回「DBの現在の行を全件取得→アーカイブへマージ」してから消す。
    {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: any[] = []
        for (let k = 0; k < 4; k++) {
            const sBot = new Date(fromMs + k * 6 * 60 * 60 * 1000).toISOString()
            const sTop = new Date(fromMs + (k + 1) * 6 * 60 * 60 * 1000).toISOString()
            // PostgRESTのmax_rows(1000)未満のページでスライス内を全件回収
            for (let off = 0; ; off += ARCHIVE_PAGE) {
                const { data: page, error } = await supabase
                    .from('articles')
                    .select(PACK_META_COLUMNS)
                    .gte('collected_at', sBot)
                    .lt('collected_at', sTop)
                    .order('collected_at', { ascending: true })
                    .order('id', { ascending: true })   // 同時刻バッチ内の順序を安定させる
                    .range(off, off + ARCHIVE_PAGE - 1)
                if (error) {
                    // アーカイブが完成しないまま削除に進まないよう、この実行は打ち切る
                    console.error(`Archive slice error (${day} k=${k} off=${off}):`, error)
                    return
                }
                if (!page || page.length === 0) break
                rows.push(...page)
                if (page.length < ARCHIVE_PAGE) break
            }
        }
        // 完全性チェック: DBに現存する行を全件取れていなければ削除に進まない
        if (rows.length !== dayCount) {
            console.error(`Archive incomplete for ${day}: got ${rows.length}/${dayCount} — skip delete`)
            return
        }
        // 量子化済み埋め込みは当日の日次パックスナップショットにあれば添える
        // （無くても、埋め込みはタイトル+概要からBGE-M3で再計算可能）
        const embMap = new Map<string, string>()
        try {
            const snap = await bucket.get(`pack/daily/${day}.json`)
            if (snap) {
                const old = JSON.parse(await snap.text()) as { articles?: { id: string; emb?: string | null }[] }
                for (const a of old.articles || []) if (a.emb) embMap.set(a.id, a.emb)
            }
        } catch { /* スナップショットが無い日はメタデータのみ */ }

        // 既存アーカイブとの和集合（DBの現在値を優先しつつ、削除済み分も残す）
        for (const r of rows) {
            const prev = merged.get(r.id)
            merged.set(r.id, {
                ...r,
                ...(embMap.has(r.id) ? { emb: embMap.get(r.id) }
                    : prev?.emb ? { emb: prev.emb } : {}),
            })
        }
        const body = JSON.stringify({
            day,
            count: merged.size,
            archived_at: new Date().toISOString(),
            articles: [...merged.values()],
        })
        await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } })
        console.log(`Archived ${day}: ${merged.size} articles, ${rows.length} from DB (${(body.length / 1024).toFixed(0)} KB)`)
    }

    // 2. アーカイブ済みの日を範囲削除。
    //    以前は「id取得→id指定削除」を10チャンク繰り返して20サブリクエストも
    //    消費し、Cloudflare無料枠(50/実行)を圧迫していた。collected_at の範囲を
    //    指定した1文の DELETE なら1サブリクエストで済む（インデックスが効く）。
    const { error: dErr } = await supabase
        .from('articles')
        .delete()
        .gte('collected_at', fromIso)
        .lt('collected_at', toIso)
    if (dErr) console.error('Retention delete error:', dErr)
    else console.log(`Retention: deleted ${day} (${dayCount} articles)`)
}

/** @param freshEmb 今回の実行で計算した量子化済み埋め込み（id → base64）。
 *  DBから取り直さずに使うことで、Cloudflare無料枠の50サブリクエスト上限を守る。 */
async function generateAndUploadPack(
    supabase: SupabaseClient,
    bucket: R2Bucket,
    freshEmb: Map<string, string> = new Map(),
): Promise<void> {
    // 1. メタデータのみ取得（embedding_m3はフィルタにだけ使い、列としては読まない）。
    //    埋め込み込みの一括読み出しはTOAST読み出しがタイムアウトするため、
    //    埋め込みは旧パックからの再利用を基本とする（増分方式）。
    //    最新記事の時刻を起点に、6時間ずつの時間スライスで遡って集める。
    const { data: head, error: headErr } = await supabase
        .from('articles')
        .select('collected_at')
        .not('embedding_m3', 'is', null)
        .order('collected_at', { ascending: false })
        .limit(1)
    if (headErr || !head || head.length === 0) {
        console.error('Pack head query error:', headErr)
        return
    }
    // DBはマイクロ秒精度・Dateはミリ秒精度なので、+1msして最新行が上限に含まれるようにする
    const topMs = Date.parse(head[0].collected_at) + 1

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = []
    for (let k = 0; k < PACK_META_MAX_SLICES && data.length < PACK_SIZE; k++) {
        const sliceTop = new Date(topMs - k * PACK_META_SLICE_MS).toISOString()
        const sliceBottom = new Date(topMs - (k + 1) * PACK_META_SLICE_MS).toISOString()
        const { data: page, error } = await supabase
            .from('articles')
            .select(PACK_META_COLUMNS)
            .not('embedding_m3', 'is', null)
            .lt('collected_at', sliceTop)
            .gte('collected_at', sliceBottom)
            .order('collected_at', { ascending: false })
            .limit(PACK_SIZE - data.length)

        if (error) {
            // 失敗したスライスは飛ばして続行（そこだけ欠けた縮小パックになる）
            console.error(`Pack meta slice ${k} error:`, error)
            continue
        }
        if (page) data.push(...page)
    }
    if (data.length === 0) return

    // 2. 旧パックから量子化済み埋め込みを回収（id → base64）。R2はタイムアウトしない
    const embMap = new Map<string, string>()
    try {
        const oldObj = await bucket.get('pack/latest.json')
        if (oldObj) {
            const old = JSON.parse(await oldObj.text()) as { articles?: { id: string; emb?: string | null }[] }
            for (const a of old.articles || []) {
                if (a.emb) embMap.set(a.id, a.emb)
            }
        }
    } catch (e) {
        console.warn('old pack read failed (falling back to DB for all embeddings):', e)
    }

    // 2.5 今回の実行で計算したばかりの埋め込みを流用する（DBから取り直さない）。
    //     Cloudflare無料枠は1実行あたり50サブリクエストしかなく、400件分を
    //     20件ずつ取り直すと20回も消費して他の処理を巻き添えに落としていた。
    for (const [id, b64] of freshEmb) embMap.set(id, b64)

    // 3. 旧パックにも今回分にも無い記事の埋め込みだけをDBから少数ずつ取得
    const missingIds = data.filter(a => !embMap.has(a.id)).map(a => a.id)
    for (let i = 0; i < missingIds.length; i += PACK_EMB_CHUNK) {
        const chunk = missingIds.slice(i, i + PACK_EMB_CHUNK)
        const { data: rows, error } = await supabase
            .from('articles')
            .select('id, embedding_m3')
            .in('id', chunk)
        if (error) {
            // 取れなかった分は emb: null で配信し、次回の実行で再取得を試みる
            console.error(`Pack embedding query error (chunk ${i / PACK_EMB_CHUNK}):`, error)
            continue
        }
        for (const r of rows || []) {
            const vec = parseVector(r.embedding_m3)
            const b64 = vec ? quantizeToBase64(vec) : null
            if (b64) embMap.set(r.id, b64)
        }
    }
    console.log(`Pack build: meta=${data.length}, reused emb=${data.length - missingIds.length}, fetched emb=${missingIds.length}`)

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
            emb: embMap.get(a.id) || null,
        }
    })

    // 話題のキーワード（今日特有×注目度）。失敗してもパック生成は続行
    let hotKeywords: string[] = []
    try {
        hotKeywords = await computeHotKeywords(supabase, data || [], socialMap)
    } catch (e) {
        console.warn('hot keywords computation failed:', e)
    }

    const pack = JSON.stringify({
        dim: 1024,
        count: articles.length,
        generated_at: new Date().toISOString(),
        latest,
        hot_keywords: hotKeywords,
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

        let processedCount = 0

        // ============================================================
        // 1. 埋め込み生成（速い経路 = ニュースがフィードに出るための必須処理）
        //    記事はパックに載るのに「埋め込み」だけを必要とし、栄養素スコアは
        //    後から埋めればよい。以前は埋め込みとLLM解析を同じループに縛って
        //    1回50件しか進めず、収集1000件超に対して時速100件しか処理できず
        //    ニュースが数時間遅れて表示される致命的な遅延を招いていた。
        //    埋め込み(BGE-M3)は安価・高速なので大きく回し、遅いLLM解析からは切り離す。
        // ============================================================
        const { data: pending, error: pendErr } = await supabase
            .from('articles')
            .select('id, title, link, summary')
            .is('embedding_m3', null)
            .order('collected_at', { ascending: false })
            .limit(EMBED_LIMIT)

        if (pendErr) {
            console.error('Pending fetch error:', pendErr)
            return
        }

        let embedded = 0
        // 今回計算した量子化済み埋め込み（id → base64）。パック生成でDBから
        // 取り直さずに再利用し、サブリクエストを節約する
        const freshEmb = new Map<string, string>()
        if (pending && pending.length > 0) {
            for (let i = 0; i < pending.length; i += EMBED_CHUNK) {
                const chunk = pending.slice(i, i + EMBED_CHUNK)
                try {
                    const texts = chunk.map(a => `${a.title} ${a.summary || ''}`.trim())
                    const res = await env.AI.run('@cf/baai/bge-m3', { text: texts })
                    const vecs: number[][] | undefined = res?.data
                    if (!vecs || vecs.length !== chunk.length) {
                        throw new Error(`embedding count mismatch: got ${vecs?.length}, want ${chunk.length}`)
                    }
                    // 埋め込みだけを更新（title/linkはNOT NULL列なのでupsertのINSERT節用に必須）
                    const rows = chunk.map((a, idx) => ({
                        id: a.id, title: a.title, link: a.link, embedding_m3: vecs[idx],
                    }))
                    const { error: upErr } = await supabase.from('articles').upsert(rows, { onConflict: 'id' })
                    if (upErr) throw upErr
                    for (let k = 0; k < chunk.length; k++) {
                        const b64 = quantizeToBase64(vecs[k])
                        if (b64) freshEmb.set(chunk[k].id, b64)
                    }
                    embedded += chunk.length
                } catch (e) {
                    // 失敗チャンクで打ち切り、残りは次回実行で再試行（部分的な前進は保持）
                    console.error(`Embedding chunk ${i / EMBED_CHUNK} failed:`, e)
                    break
                }
            }
            processedCount += embedded
            console.log(`Embedded ${embedded}/${pending.length} articles (pending was capped at ${EMBED_LIMIT})`)
        } else {
            console.log('No articles to embed.')
        }

        // ============================================================
        // 2. LLM解析（遅い経路 = 栄養素・中分類・キーワードの付与）
        //    埋め込み済みで栄養素が未生成の記事を、新しい順に少しずつ解析する。
        //    さくらの無料枠（3,000req/月）に収まるよう1回の件数を絞る
        //    （ANALYZE_LIMIT=24 → バッチ12で2req/回 → 約96req/日）。
        //    ここが遅れてもニュースの表示は止まらない（スコアは後追いで埋まる）。
        // ============================================================
        try {
            const { data: needScore } = await supabase
                .from('articles')
                .select('id, title, link, summary, category_medium, category_minor')
                .not('embedding_m3', 'is', null)
                .is('fact_score', null)
                .order('collected_at', { ascending: false })
                .limit(ANALYZE_LIMIT)

            if (needScore && needScore.length > 0) {
                // さくらは SAKURA_BATCHES_PER_RUN バッチまで（枠の温存）。残りはGroqへ
                const map = await analyzeArticles(env, needScore as Article[], SAKURA_BATCHES_PER_RUN)
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
                    if (bfError) console.error('Analysis update error:', bfError)
                    else {
                        processedCount += rows.length
                        console.log(`Analyzed ${rows.length}/${needScore.length} articles.`)
                    }
                }
            }
        } catch (e) {
            console.error('Analysis error:', e)
        }

        // 5. パック生成 → R2
        //    新規処理があったとき、または latest.json が未生成のときに更新する。
        //    今回計算した埋め込み(freshEmb)を渡し、DBから取り直さない（サブリクエスト節約）
        if (env.PACK_BUCKET) {
            const needsPack = processedCount > 0 || !(await env.PACK_BUCKET.head('pack/latest.json'))
            if (needsPack) {
                ctx.waitUntil(generateAndUploadPack(supabase, env.PACK_BUCKET, freshEmb))
            } else {
                console.log('Pack is up to date, skipping upload.')
            }
        } else {
            console.warn('PACK_BUCKET binding not configured — pack generation skipped.')
        }

        // 6. 日次プッシュ通知（JST朝 6時台 = UTC 21時台の実行でのみ試行、1日1回）。
        //    cronを終日化(*/30)したため、cron文字列ではなくUTC時刻で朝の窓を判定する。
        //    実際の重複送信防止は sendDailyPushOnce のR2日付マーカーが担う。
        if (new Date().getUTCHours() === 21) {
            ctx.waitUntil(sendDailyPushOnce(env, supabase))
        }

        // 7. 研究用アーカイブ + retention（30日より古い日をR2へ退避してDBから削除）
        //    DBは「直近のホットデータ専用」に保ち、テーブル肥大化による
        //    statement timeout 障害（2026-07-13）の根本原因を断つ。
        //    サブリクエストを多く使うため毎時1回（:00の実行）だけに絞る。
        //    1日24回動けば、退避すべき日（1日1つ）の消化には十分。
        if (env.PACK_BUCKET && new Date().getUTCMinutes() < 30) {
            ctx.waitUntil(archiveAndPruneOldest(supabase, env.PACK_BUCKET))
        }
    }
}
