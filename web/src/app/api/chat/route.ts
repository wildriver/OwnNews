import { groq } from '@/lib/groq'
import { streamText } from 'ai'

export const runtime = 'edge'

export async function POST(req: Request) {
    const { messages } = await req.json()

    const result = streamText({
        model: groq('llama-3.3-70b-versatile'),
        messages,
        // 記事の要約・再現は行わない（著作権配慮）。記事に書かれていない背景・文脈の解説に限定する
        system: "You are a professional news analyst. Provide background knowledge, historical context, impact, and future outlook that are NOT written in the article itself. Do NOT summarize, quote, or reproduce the article text. Always encourage reading the original article for details. Respond in Japanese. Keep it concise (within 400 characters).",
    })

    return result.toDataStreamResponse()
}
