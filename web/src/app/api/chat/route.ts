import { groq } from '@/lib/groq'
import { streamText } from 'ai'

export const runtime = 'edge'

export async function POST(req: Request) {
    const { messages } = await req.json()

    const result = streamText({
        model: groq('llama-3.3-70b-versatile'),
        messages,
        system: "You are a professional news analyst. Please analyze the following news article and provide insights on its background, impact, and future outlook. Respond in Japanese. Keep it concise (within 400 characters).",
    })

    return result.toDataStreamResponse()
}
