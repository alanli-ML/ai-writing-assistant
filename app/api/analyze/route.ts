import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

export async function POST(req: NextRequest) {
  try {
    // Create OpenAI client at runtime to ensure environment variable is available
    const openaiClient = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })

    const { text, preferredTone, writingGoals } = await req.json()

    console.log("📝 Analyzing text:", {
      textLength: text?.length || 0,
      preferredTone: preferredTone || 'none',
      writingGoals: writingGoals || [],
      textPreview: text?.substring(0, 100) + (text?.length > 100 ? '...' : '')
    })

    if (!text || text.length < 20) {
      console.log("⚠️ Text too short for analysis, returning empty suggestions")
      return NextResponse.json({ suggestions: [] })
    }

    const { text: result } = await generateText({
      model: openaiClient("gpt-4o"),
      system: `You are an AI writing assistant for marketing professionals. 
      Analyze the provided text and identify issues with grammar, tone, and persuasion.
      ${preferredTone ? `The user prefers a ${preferredTone} tone.` : ""}
      ${writingGoals ? `Focus on these specific areas: ${writingGoals.join(", ")}.` : ""}
      
      CRITICAL: When extracting the "original" text, copy it EXACTLY character-for-character from the input text. 
      Do not paraphrase, rephrase, or modify the original text in any way. The "original" field must be an exact substring of the input.
      For disambiguation, especially for short words, also provide surrounding context.
      
      Return a JSON array of suggestions with the following structure:
      [
        {
          "id": "unique-id",
          "type": "grammar|tone|persuasion",
          "position": { "start": 0, "end": 0 },
          "original": "EXACT text from input - copy verbatim",
          "suggested": "suggested improvement", 
          "contextBefore": "2-5 words before the original text",
          "contextAfter": "2-5 words after the original text",
          "explanation": "why this change improves the text",
          "confidence": number between 0-1
        }
      ]
      
      IMPORTANT RULES:
      1. The "original" text must be copied EXACTLY from the input text
      2. For short words (1-3 characters), ALWAYS provide contextBefore and contextAfter for disambiguation
      3. Context should be 2-5 words before/after the original text, copied exactly from input
      4. If the original text is at the beginning/end, provide empty string for missing context
      5. Only include high-confidence suggestions (>0.7)
      6. Don't worry about accurate position numbers - we'll find the text automatically
      7. If there are no issues, return an empty array
      8. Keep original text as focused as possible while maintaining meaning`,
      prompt: text,
    })

    try {
      // Extract JSON from the response
      const jsonMatch = result.match(/\[[\s\S]*\]/)?.[0]
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch)
        
        // Log the suggestions returned by the API
        console.log("🤖 AI Suggestions returned:", JSON.stringify(suggestions, null, 2))
        console.log(`📊 Total suggestions: ${suggestions.length}`)
        
        // Log summary by type
        const typeCount = suggestions.reduce((acc: Record<string, number>, suggestion: any) => {
          acc[suggestion.type] = (acc[suggestion.type] || 0) + 1
          return acc
        }, {})
        console.log("📈 Suggestions by type:", typeCount)
        
        return NextResponse.json({ suggestions })
      } else {
        console.log("❌ No suggestions found in AI response")
        return NextResponse.json({ suggestions: [] })
      }
    } catch (error) {
      console.error("Error parsing suggestions:", error)
      return NextResponse.json({ suggestions: [] })
    }
  } catch (error) {
    console.error("Error in analyze API:", error)
    console.error("Environment variable available:", !!process.env.OPENAI_API_KEY)
    return NextResponse.json({ error: "Failed to analyze text" }, { status: 500 })
  }
}
