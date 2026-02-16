import { Article, GroupedArticle } from "./types"

/**
 * Parses vector from Supabase (can be string or array)
 */
function parseVector(v: unknown): number[] {
    if (typeof v === 'string') {
        try {
            return JSON.parse(v)
        } catch {
            return []
        }
    }
    return (v as number[]) || []
}

/**
 * Calculates cosine similarity between two vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0
    let dotProduct = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i]
        normA += vecA[i] * vecA[i]
        normB += vecB[i] * vecB[i]
    }
    const mag = Math.sqrt(normA) * Math.sqrt(normB)
    return mag === 0 ? 0 : dotProduct / mag
}

/**
 * Groups similar articles based on embedding similarity
 */
export function groupSimilarArticles(
    articles: Article[],
    threshold: number = 0.92
): GroupedArticle[] {
    if (articles.length === 0) return []

    const grouped: GroupedArticle[] = []
    const used = new Set<string>()

    // Parse all vectors once
    const parsedEmbeddings = new Map<string, number[]>()
    articles.forEach(a => {
        if (a.embedding) {
            parsedEmbeddings.set(a.id, parseVector(a.embedding))
        }
    })

    for (let i = 0; i < articles.length; i++) {
        const article = articles[i]
        if (used.has(article.id)) continue

        const embI = parsedEmbeddings.get(article.id)
        const group: GroupedArticle = { ...article, related: [] }
        used.add(article.id)

        if (!embI) {
            grouped.push(group)
            continue
        }

        for (let j = 0; j < articles.length; j++) {
            const other = articles[j]
            if (used.has(other.id)) continue

            const embJ = parsedEmbeddings.get(other.id)
            if (!embJ) continue

            const sim = cosineSimilarity(embI, embJ)
            if (sim >= threshold) {
                group.related.push(other)
                used.add(other.id)
            }
        }

        grouped.push(group)
    }

    return grouped
}

/**
 * Extracts a friendly source name from a URL
 */
export function extractSourceName(url: string): string {
    if (!url) return ""
    try {
        const hostname = new URL(url).hostname
        return hostname.replace('www.', '').split('.')[0].toUpperCase()
    } catch {
        return "UNKNOWN"
    }
}
