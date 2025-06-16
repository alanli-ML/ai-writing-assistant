"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

type Suggestion = {
  id: string
  type: "grammar" | "tone" | "persuasion"
  position: {
    start: number
    end: number
  }
  original: string
  suggested: string
  explanation: string
  confidence: number
}

interface SuggestionHighlightProps {
  content: string
  suggestions: Suggestion[]
  onSuggestionClick: (suggestion: Suggestion) => void
  className?: string
}

export function SuggestionHighlight({ content, suggestions, onSuggestionClick, className }: SuggestionHighlightProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Clear previous highlights
    containerRef.current.innerHTML = ""

    if (!suggestions.length) {
      containerRef.current.textContent = content
      return
    }

    // Sort suggestions by position (start index)
    const sortedSuggestions = [...suggestions].sort((a, b) => a.position.start - b.position.start)

    let lastIndex = 0
    const fragment = document.createDocumentFragment()

    sortedSuggestions.forEach((suggestion) => {
      // Add text before the suggestion
      if (suggestion.position.start > lastIndex) {
        const textBefore = document.createTextNode(content.substring(lastIndex, suggestion.position.start))
        fragment.appendChild(textBefore)
      }

      // Create the highlighted suggestion
      const span = document.createElement("span")
      span.textContent = content.substring(suggestion.position.start, suggestion.position.end)
      span.className = getTypeClass(suggestion.type)
      span.style.cursor = "pointer"
      span.dataset.suggestionId = suggestion.id
      span.addEventListener("click", () => onSuggestionClick(suggestion))
      fragment.appendChild(span)

      lastIndex = suggestion.position.end
    })

    // Add remaining text after the last suggestion
    if (lastIndex < content.length) {
      const textAfter = document.createTextNode(content.substring(lastIndex))
      fragment.appendChild(textAfter)
    }

    containerRef.current.appendChild(fragment)
  }, [content, suggestions, onSuggestionClick])

  const getTypeClass = (type: string) => {
    switch (type) {
      case "grammar":
        return "underline decoration-blue-500 decoration-wavy decoration-2 underline-offset-4"
      case "tone":
        return "underline decoration-purple-500 decoration-wavy decoration-2 underline-offset-4"
      case "persuasion":
        return "underline decoration-amber-500 decoration-wavy decoration-2 underline-offset-4"
      default:
        return "underline decoration-gray-500 decoration-wavy decoration-2 underline-offset-4"
    }
  }

  return (
    <div ref={containerRef} className={cn("whitespace-pre-wrap break-words text-base leading-relaxed", className)}>
      {content}
    </div>
  )
}
