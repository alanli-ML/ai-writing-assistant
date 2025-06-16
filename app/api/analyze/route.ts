import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { openai } from "@ai-sdk/openai"

export async function POST(req: NextRequest) {
  try {
    const { text, preferredTone, writingGoals } = await req.json()

    if (!text || text.length < 20) {
      return NextResponse.json({ suggestions: [] })
    }

    const { text: result } = await generateText({
      model: openai("gpt-4o"),
      system: `You are an AI writing assistant for marketing professionals. 
      Analyze the provided text and identify issues with grammar, tone, and persuasion.
      ${preferredTone ? `The user prefers a ${preferredTone} tone.` : ""}
      ${writingGoals ? `Focus on these specific areas: ${writingGoals.join(", ")}.` : ""}
      
      Return a JSON array of suggestions with the following structure:
      [
        {
          "id": "unique-id",
          "type": "grammar|tone|persuasion",
          "position": { "start": number, "end": number },
          "original": "original text",
          "suggested": "suggested improvement",
          "explanation": "why this change improves the text",
          "confidence": number between 0-1
        }
      ]
      Only include high-confidence suggestions (>0.7). Limit to 5 most important suggestions.
      If there are no issues, return an empty array.`,
      prompt: text,
    })

    try {
      // Extract JSON from the response
      const jsonMatch = result.match(/\[[\s\S]*\]/)?.[0]
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch)
        return NextResponse.json({ suggestions })
      } else {
        return NextResponse.json({ suggestions: [] })
      }
    } catch (error) {
      console.error("Error parsing suggestions:", error)
      return NextResponse.json({ suggestions: [] })
    }
  } catch (error) {
    console.error("Error in analyze API:", error)
    return NextResponse.json({ error: "Failed to analyze text" }, { status: 500 })
  }
}
