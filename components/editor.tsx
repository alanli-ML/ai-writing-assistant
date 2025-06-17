"use client"

import type React from "react"

import { useEffect, useState, useRef } from "react"
import { Loader2, MessageSquare, Sparkles, X } from "lucide-react"
import { doc, getDoc } from "firebase/firestore"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"
import { useAuth, db } from "@/components/auth-provider"

type Suggestion = {
  id: string
  type: "grammar" | "tone" | "persuasion"
  position: {
    start: number
    end: number
  }
  original: string
  suggested: string
  contextBefore?: string
  contextAfter?: string
  explanation: string
  confidence: number
}

interface EditorProps {
  content: string
  onChange: (content: string) => void
}

export function Editor({ content, onChange }: EditorProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [value, setValue] = useState(content)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion | null>(null)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [analysisWindow, setAnalysisWindow] = useState<{start: number, end: number} | null>(null)
  const [previousText, setPreviousText] = useState(content)
  const [userSettings, setUserSettings] = useState<{
    preferredTone: string
    writingGoals: string[]
  }>({
    preferredTone: "professional",
    writingGoals: ["clarity", "grammar"]
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setValue(content)
    setPreviousText(content)
  }, [content])

  // Fetch user settings when user changes
  useEffect(() => {
    async function fetchUserSettings() {
      if (!user) return

      try {
        const userDocRef = doc(db, "users", user.uid)
        const userDoc = await getDoc(userDocRef)

        if (userDoc.exists()) {
          const data = userDoc.data()
          setUserSettings({
            preferredTone: data.preferredTone || "professional",
            writingGoals: data.writingGoals || ["clarity", "grammar"]
          })
        }
      } catch (error) {
        console.error("Error fetching user settings:", error)
        // Keep default settings on error
      }
    }

    fetchUserSettings()
  }, [user])

  // Sync highlight overlay with textarea scroll and resize
  useEffect(() => {
    const textarea = textareaRef.current
    const highlight = highlightRef.current
    
    if (!textarea || !highlight) return

    const syncOverlay = () => {
      // Copy all relevant styles from textarea to highlight overlay
      const computedStyle = window.getComputedStyle(textarea)
      highlight.style.fontSize = computedStyle.fontSize
      highlight.style.fontFamily = computedStyle.fontFamily
      highlight.style.lineHeight = computedStyle.lineHeight
      highlight.style.letterSpacing = computedStyle.letterSpacing
      highlight.style.wordSpacing = computedStyle.wordSpacing
      highlight.style.textIndent = computedStyle.textIndent
      highlight.style.padding = computedStyle.padding
      highlight.style.border = computedStyle.border
      highlight.style.borderWidth = computedStyle.borderWidth
      highlight.style.margin = computedStyle.margin
      
      // Sync scroll position
      highlight.scrollTop = textarea.scrollTop
      highlight.scrollLeft = textarea.scrollLeft
    }

    // Initial sync
    syncOverlay()

    // Sync on scroll
    textarea.addEventListener('scroll', syncOverlay)
    
    // Sync on resize
    const resizeObserver = new ResizeObserver(syncOverlay)
    resizeObserver.observe(textarea)

    return () => {
      textarea.removeEventListener('scroll', syncOverlay)
      resizeObserver.disconnect()
    }
  }, [])

  const getContextualWindow = (text: string, cursorPos: number) => {
    // Return the entire text for analysis
    return {
      text: text,
      startOffset: 0,
      endOffset: text.length
    }
  }

  const renderHighlightedText = () => {
    if (!value) return ""

    // Collect all highlight regions
    const highlights: Array<{
      start: number
      end: number
      className: string
      priority: number
      suggestion?: Suggestion
    }> = []

    // Add highlights for all suggestions using improved fuzzy matching
    suggestions.forEach((suggestion) => {
      const exactPosition = findExactTextPosition(
        value,
        suggestion.original,
        suggestion.position.start,
        suggestion.position.end,
        suggestion.contextBefore,
        suggestion.contextAfter
      )

      if (exactPosition.found) {
        // Verify the found text matches the original text
        const foundText = value.substring(exactPosition.start, exactPosition.end)
        if (foundText === suggestion.original) {
          // Check if this is the selected suggestion for enhanced highlighting
          const isSelected = selectedSuggestion?.id === suggestion.id
          
          highlights.push({
            start: exactPosition.start,
            end: exactPosition.end,
            className: isSelected 
              ? `${getHighlightColor(suggestion.type)} rounded-sm px-1 ring-2 ring-offset-1 ring-current opacity-100`
              : `${getHighlightColor(suggestion.type)} rounded-sm px-1 opacity-60 hover:opacity-80 cursor-pointer`,
            priority: isSelected ? 2 : 1,
            suggestion: suggestion
          })
          
          // Check if position was corrected during highlighting
          if (exactPosition.start !== suggestion.position.start || exactPosition.end !== suggestion.position.end) {
            console.log(`🔄 Position corrected during highlighting for "${suggestion.original}":`, {
              stored: suggestion.position,
              corrected: { start: exactPosition.start, end: exactPosition.end }
            })
          }
          
          console.log(`✅ Highlighting suggestion "${suggestion.original}" at position ${exactPosition.start}-${exactPosition.end}`)
        } else {
          console.log(`❌ Text mismatch for highlighting "${suggestion.original}": expected "${suggestion.original}", found "${foundText}"`)
        }
      } else {
        console.log(`❌ Could not find position for highlighting suggestion "${suggestion.original}"`)
      }
    })

    // If no highlights, return plain text
    if (highlights.length === 0) {
      return <span>{value}</span>
    }

    // Sort highlights by priority (higher priority on top) and then by start position
    highlights.sort((a, b) => b.priority - a.priority || a.start - b.start)

    // Create text segments with highlights
    const segments: React.ReactNode[] = []
    let currentPos = 0

    // Use the highest priority highlight that overlaps with each position
    for (let i = 0; i < value.length; i++) {
      const applicableHighlight = highlights.find(h => i >= h.start && i < h.end)
      
      if (applicableHighlight) {
        // Add any plain text before this highlight
        if (currentPos < applicableHighlight.start) {
          segments.push(
            <span key={`text-${currentPos}`}>
              {value.substring(currentPos, applicableHighlight.start)}
            </span>
          )
        }

        // Add the highlighted text
        segments.push(
          <span 
            key={`highlight-${applicableHighlight.start}`} 
            className={applicableHighlight.className}
            onClick={applicableHighlight.suggestion ? () => handleSuggestionClick(applicableHighlight.suggestion!) : undefined}
            title={applicableHighlight.suggestion ? `${applicableHighlight.suggestion.type}: ${applicableHighlight.suggestion.explanation}` : undefined}
          >
            {value.substring(applicableHighlight.start, applicableHighlight.end)}
          </span>
        )

        // Move current position to end of this highlight
        currentPos = applicableHighlight.end
        i = applicableHighlight.end - 1 // -1 because loop will increment
      }
    }

    // Add any remaining plain text
    if (currentPos < value.length) {
      segments.push(
        <span key={`text-${currentPos}`}>
          {value.substring(currentPos)}
        </span>
      )
    }

    return <>{segments}</>
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart
    const oldValue = previousText
    
    // Calculate where the change started by finding the first difference
    let changeStart = 0
    const minLength = Math.min(oldValue.length, newValue.length)
    for (let i = 0; i < minLength; i++) {
      if (oldValue[i] !== newValue[i]) {
        changeStart = i
        break
      }
    }
    // If no character differences found, change starts at the end of the shorter string
    if (changeStart === 0 && oldValue !== newValue) {
      changeStart = minLength
    }

    setValue(newValue)
    onChange(newValue)
    setCursorPosition(newCursorPosition)
    setPreviousText(newValue)

    // Update suggestion positions based on the text change
    if (oldValue !== newValue && suggestions.length > 0) {
      updateSuggestionPositions(oldValue, newValue, changeStart)
    }

    // Clear previous timeout and analysis window
    if (typingTimeout) {
      clearTimeout(typingTimeout)
    }
    setAnalysisWindow(null)

    // Set new timeout to analyze text after user stops typing
    const timeout = setTimeout(() => {
      analyzeText(newValue, newCursorPosition)
    }, 2000)

    setTypingTimeout(timeout)
  }

  const analyzeText = async (text: string, cursorPos: number = cursorPosition) => {
    if (!text || text.length < 20) {
      setSuggestions([])
      setAnalysisWindow(null)
      return
    }

    // Get contextual window around the cursor position
    const contextWindow = getContextualWindow(text, cursorPos)
    
    if (contextWindow.text.length < 20) {
      setSuggestions([])
      setAnalysisWindow(null)
      return
    }

    // Set the analysis window for highlighting
    setAnalysisWindow({
      start: contextWindow.startOffset,
      end: contextWindow.endOffset
    })

    setAnalyzing(true)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: contextWindow.text,
          preferredTone: userSettings.preferredTone,
          writingGoals: userSettings.writingGoals
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      
      if (data.error) {
        throw new Error(data.error)
      }

      // Adjust suggestion positions to account for the context window offset
      const adjustedSuggestions = (data.suggestions || []).map((suggestion: Suggestion) => ({
        ...suggestion,
        position: {
          start: suggestion.position.start + contextWindow.startOffset,
          end: suggestion.position.end + contextWindow.startOffset
        }
      }))

      // Correct suggestion positions using improved fuzzy matching
      const correctedSuggestions = adjustedSuggestions
        .map((suggestion: Suggestion): Suggestion | null => {
          const exactPosition = findExactTextPosition(
            text, // Use the full text, not just value
            suggestion.original,
            suggestion.position.start,
            suggestion.position.end,
            suggestion.contextBefore,
            suggestion.contextAfter
          )

          if (exactPosition.found) {
            console.log(`✅ Corrected position for suggestion "${suggestion.original}":`, {
              original: suggestion.position,
              corrected: { start: exactPosition.start, end: exactPosition.end },
              textAtPosition: text.substring(exactPosition.start, exactPosition.end)
            })
            
            return {
              ...suggestion,
              position: {
                start: exactPosition.start,
                end: exactPosition.end
              }
            }
          } else {
            console.log(`❌ Could not find accurate position for suggestion "${suggestion.original}"`)
            return null // Mark for removal
          }
        })
        .filter((s: Suggestion | null): s is Suggestion => s !== null) // Remove suggestions we couldn't locate

      // Log received suggestions
      console.log("🎯 Suggestions received from API:", adjustedSuggestions.length)
      console.log("✅ Suggestions with corrected positions:", correctedSuggestions.length)
      console.log("📍 Final suggestion positions:", correctedSuggestions.map((s: Suggestion) => ({
        id: s.id,
        type: s.type,
        original: s.original,
        suggested: s.suggested,
        position: s.position,
        textAtPosition: text.substring(s.position.start, s.position.end)
      })))

      setSuggestions(correctedSuggestions)
    } catch (error) {
      console.error("Error analyzing text:", error)
      toast({
        variant: "destructive",
        title: "Analysis failed",
        description: "Failed to analyze your text. Please try again.",
      })
      setAnalysisWindow(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const findExactTextPosition = (
    text: string, 
    searchText: string, 
    startPos: number, 
    endPos: number, 
    contextBefore?: string, 
    contextAfter?: string
  ) => {
    console.log("🔍 Searching for text:", { 
      searchText, 
      contextBefore, 
      contextAfter, 
      suggestedPos: { start: startPos, end: endPos } 
    })
    
    // First, try the exact positions provided by the API
    if (startPos >= 0 && endPos <= text.length && startPos < endPos) {
      const exactMatch = text.substring(startPos, endPos)
      if (exactMatch === searchText) {
        console.log("✅ Found exact match at suggested position")
        return { start: startPos, end: endPos, found: true }
      }
      console.log("❌ No match at suggested position. Expected:", searchText, "Got:", exactMatch)
    }

    // If we have context, use it for disambiguation
    if (contextBefore || contextAfter) {
      const contextMatches = findWithContext(text, searchText, contextBefore, contextAfter)
      if (contextMatches.length > 0) {
        console.log("✅ Found match using context:", contextMatches[0])
        return { start: contextMatches[0].start, end: contextMatches[0].end, found: true }
      }
    }

    // Search for exact text matches in the entire document
    let searchIndex = text.indexOf(searchText)
    const foundPositions: Array<{start: number, end: number}> = []
    
    while (searchIndex !== -1) {
      foundPositions.push({
        start: searchIndex,
        end: searchIndex + searchText.length
      })
      searchIndex = text.indexOf(searchText, searchIndex + 1)
    }

    console.log(`🔍 Found ${foundPositions.length} exact matches for "${searchText}"`)

    if (foundPositions.length === 1) {
      // If we found exactly one match, use it
      console.log("✅ Using single exact match:", foundPositions[0])
      return { start: foundPositions[0].start, end: foundPositions[0].end, found: true }
    } else if (foundPositions.length > 1) {
      // If multiple matches, find the closest to the suggested position
      const closestMatch = foundPositions.reduce((closest, current) => {
        const closestDistance = Math.abs(closest.start - startPos)
        const currentDistance = Math.abs(current.start - startPos)
        return currentDistance < closestDistance ? current : closest
      })
      console.log("✅ Using closest match to suggested position:", closestMatch)
      return { start: closestMatch.start, end: closestMatch.end, found: true }
    }

    // If no exact matches, try fuzzy matching with similar text
    const fuzzyMatches = findFuzzyMatches(text, searchText, startPos)
    if (fuzzyMatches.length > 0) {
      console.log("✅ Using fuzzy match:", fuzzyMatches[0])
      return { start: fuzzyMatches[0].start, end: fuzzyMatches[0].end, found: true }
    }

    console.log("❌ No matches found for:", searchText)
    return { start: startPos, end: endPos, found: false }
  }

  const findWithContext = (
    text: string, 
    searchText: string, 
    contextBefore?: string, 
    contextAfter?: string
  ) => {
    const matches: Array<{start: number, end: number, score: number}> = []
    
    // Find all instances of the search text
    let searchIndex = text.indexOf(searchText)
    
    while (searchIndex !== -1) {
      let score = 1 // Base score for exact text match
      let isValidMatch = true
      
      // Check context before if provided
      if (contextBefore && contextBefore.trim()) {
        const beforeText = text.substring(Math.max(0, searchIndex - contextBefore.length - 10), searchIndex)
        if (!beforeText.includes(contextBefore)) {
          isValidMatch = false
          console.log(`❌ Context before mismatch at position ${searchIndex}:`, {
            expected: contextBefore,
            found: beforeText.slice(-20) // Last 20 chars for context
          })
        } else {
          score += 2 // Boost score for matching before context
        }
      }
      
      // Check context after if provided
      if (contextAfter && contextAfter.trim()) {
        const afterStart = searchIndex + searchText.length
        const afterText = text.substring(afterStart, Math.min(text.length, afterStart + contextAfter.length + 10))
        if (!afterText.includes(contextAfter)) {
          isValidMatch = false
          console.log(`❌ Context after mismatch at position ${searchIndex}:`, {
            expected: contextAfter,
            found: afterText.slice(0, 20) // First 20 chars for context
          })
        } else {
          score += 2 // Boost score for matching after context
        }
      }
      
      if (isValidMatch) {
        matches.push({
          start: searchIndex,
          end: searchIndex + searchText.length,
          score
        })
        console.log(`✅ Valid context match found at position ${searchIndex} with score ${score}`)
      }
      
      searchIndex = text.indexOf(searchText, searchIndex + 1)
    }
    
    // Sort by score (highest first) and return
    return matches.sort((a, b) => b.score - a.score)
  }

  const findFuzzyMatches = (text: string, searchText: string, hintPos: number) => {
    const matches: Array<{start: number, end: number, confidence: number}> = []
    const searchWords = searchText.toLowerCase().split(/\s+/).filter(word => word.length > 2)
    
    if (searchWords.length === 0) return matches

    // Create a search window around the hint position
    const windowSize = Math.min(500, text.length)
    const windowStart = Math.max(0, hintPos - windowSize / 2)
    const windowEnd = Math.min(text.length, hintPos + windowSize / 2)
    const searchWindow = text.substring(windowStart, windowEnd).toLowerCase()

    // Look for sequences that contain most of the search words
    const words = searchWindow.split(/\s+/)
    
    for (let i = 0; i < words.length - searchWords.length + 1; i++) {
      const windowSlice = words.slice(i, i + searchWords.length * 2).join(' ')
      
      let matchedWords = 0
      for (const searchWord of searchWords) {
        if (windowSlice.includes(searchWord)) {
          matchedWords++
        }
      }
      
      const confidence = matchedWords / searchWords.length
      
      if (confidence >= 0.6) { // At least 60% of words match
        // Find the actual position in the original text
        const sliceStart = searchWindow.indexOf(windowSlice)
        if (sliceStart !== -1) {
          const actualStart = windowStart + sliceStart
          const actualEnd = Math.min(text.length, actualStart + searchText.length * 1.5)
          
          matches.push({
            start: actualStart,
            end: actualEnd,
            confidence
          })
        }
      }
    }

    // Sort by confidence and proximity to hint position
    return matches
      .sort((a, b) => {
        const aScore = a.confidence - Math.abs(a.start - hintPos) / 1000
        const bScore = b.confidence - Math.abs(b.start - hintPos) / 1000
        return bScore - aScore
      })
      .slice(0, 3) // Return top 3 matches
  }

  const updateSuggestionPositions = (oldText: string, newText: string, changeStart: number) => {
    if (suggestions.length === 0) return

    // Calculate the change details
    const lengthDifference = newText.length - oldText.length
    
    console.log("🔄 Updating suggestion positions:", {
      changeStart,
      lengthDifference,
      oldTextLength: oldText.length,
      newTextLength: newText.length,
      currentSuggestions: suggestions.length
    })
    
    // Update suggestion positions based on where the change occurred
    const updatedSuggestions = suggestions
      .map((suggestion) => {
        // If the suggestion starts after the change, shift its position
        if (suggestion.position.start >= changeStart) {
          return {
            ...suggestion,
            position: {
              start: suggestion.position.start + lengthDifference,
              end: suggestion.position.end + lengthDifference
            }
          }
        }
        // If the suggestion overlaps with the change area, remove it
        else if (suggestion.position.end > changeStart) {
          return null // Mark for removal
        }
        // If the suggestion is completely before the change, keep it unchanged
        else {
          return suggestion
        }
      })
      .filter((s): s is Suggestion => s !== null) // Remove null entries
      .map((suggestion): Suggestion | null => {
        // Re-verify and correct positions using improved fuzzy matching
        const exactPosition = findExactTextPosition(
          newText,
          suggestion.original,
          suggestion.position.start,
          suggestion.position.end,
          suggestion.contextBefore,
          suggestion.contextAfter
        )
        
        if (exactPosition.found) {
          // Update suggestion with corrected position if needed
          if (exactPosition.start !== suggestion.position.start || exactPosition.end !== suggestion.position.end) {
            console.log(`🔄 Corrected suggestion position after text change:`, {
              id: suggestion.id,
              original: suggestion.position,
              corrected: { start: exactPosition.start, end: exactPosition.end },
              textAtPosition: newText.substring(exactPosition.start, exactPosition.end)
            })
            
            return {
              ...suggestion,
              position: {
                start: exactPosition.start,
                end: exactPosition.end
              }
            }
          } else {
            return suggestion // Position is already correct
          }
        } else {
          console.log(`❌ Suggestion "${suggestion.original}" could not be relocated after text change`)
          return null // Mark for removal
        }
      })
      .filter((s): s is Suggestion => s !== null) // Remove suggestions that couldn't be relocated

    setSuggestions(updatedSuggestions)

    // Log the results of position updates
    console.log("✅ Suggestion positions updated and verified:", {
      before: suggestions.length,
      after: updatedSuggestions.length,
      removed: suggestions.length - updatedSuggestions.length,
      relocated: updatedSuggestions.filter(s => {
        const originalSuggestion = suggestions.find(orig => orig.id === s.id)
        return originalSuggestion && (
          originalSuggestion.position.start !== s.position.start || 
          originalSuggestion.position.end !== s.position.end
        )
      }).length,
      finalPositions: updatedSuggestions.map((s: Suggestion) => ({
        id: s.id,
        type: s.type,
        original: s.original,
        position: s.position,
        textAtPosition: newText.substring(s.position.start, s.position.end)
      }))
    })

    console.log("🎨 Highlighting will be refreshed with updated positions")

    // If the selected suggestion was removed or invalidated, clear it
    if (selectedSuggestion) {
      const isStillValid = updatedSuggestions.some(s => s.id === selectedSuggestion.id)
      if (!isStillValid) {
        console.log("❌ Selected suggestion was invalidated:", selectedSuggestion.id)
        setSelectedSuggestion(null)
      } else {
        // Update the selected suggestion with new position if it was shifted
        const updatedSelectedSuggestion = updatedSuggestions.find(s => s.id === selectedSuggestion.id)
        if (updatedSelectedSuggestion) {
          console.log("🎯 Selected suggestion position updated:", {
            id: updatedSelectedSuggestion.id,
            oldPosition: selectedSuggestion.position,
            newPosition: updatedSelectedSuggestion.position
          })
          setSelectedSuggestion(updatedSelectedSuggestion)
        }
      }
    }
  }

  const handleSuggestionClick = (suggestion: Suggestion) => {
    setSelectedSuggestion(suggestion)
    
    // Find the exact position of the text to be changed
    const exactPosition = findExactTextPosition(
      value, 
      suggestion.original, 
      suggestion.position.start, 
      suggestion.position.end,
      suggestion.contextBefore,
      suggestion.contextAfter
    )
    
    // Move cursor to the beginning of the actual text location
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(exactPosition.start, exactPosition.start)
    }
    
    // Update the suggestion with the corrected position
    if (exactPosition.found && (exactPosition.start !== suggestion.position.start || exactPosition.end !== suggestion.position.end)) {
      const updatedSuggestion = {
        ...suggestion,
        position: {
          start: exactPosition.start,
          end: exactPosition.end
        }
      }
      setSelectedSuggestion(updatedSuggestion)
      
      // Also update the suggestion in the suggestions array
      setSuggestions(suggestions.map(s => 
        s.id === suggestion.id ? updatedSuggestion : s
      ))
    }
  }

  const applySuggestion = (suggestion: Suggestion) => {
    if (!textareaRef.current) return

    // Find the exact position before applying the suggestion
    const exactPosition = findExactTextPosition(
      value, 
      suggestion.original, 
      suggestion.position.start, 
      suggestion.position.end,
      suggestion.contextBefore,
      suggestion.contextAfter
    )

    if (!exactPosition.found) {
      toast({
        variant: "destructive",
        title: "Could not apply suggestion",
        description: "The original text could not be found in the document. Please apply changes manually.",
      })
      return
    }

    const newText =
      value.substring(0, exactPosition.start) + suggestion.suggested + value.substring(exactPosition.end)

    setValue(newText)
    onChange(newText)
    setPreviousText(newText)

    // Calculate the length difference caused by the replacement
    const lengthDifference = suggestion.suggested.length - suggestion.original.length

    // Log suggestion application
    console.log("💡 Applying suggestion:", {
      id: suggestion.id,
      type: suggestion.type,
      original: suggestion.original,
      suggested: suggestion.suggested,
      position: exactPosition,
      lengthDifference,
      remainingSuggestions: suggestions.length - 1
    })

    // Update positions of remaining suggestions
    const updatedSuggestions = suggestions
      .filter((s) => s.id !== suggestion.id) // Remove the applied suggestion
      .map((s) => {
        // If suggestion starts after the applied change, adjust its position
        if (s.position.start >= exactPosition.end) {
          return {
            ...s,
            position: {
              start: s.position.start + lengthDifference,
              end: s.position.end + lengthDifference
            }
          }
        }
        // If suggestion overlaps with the applied change, remove it (it's no longer valid)
        else if (s.position.end > exactPosition.start && s.position.start < exactPosition.end) {
          return null // Mark for removal
        }
        // If suggestion is completely before the applied change, keep it unchanged
        else {
          return s
        }
      })
      .filter((s): s is Suggestion => s !== null) // Remove null entries (overlapping suggestions)

    // Log the position updates after applying suggestion
    console.log("📍 Positions updated after applying suggestion:", {
      appliedSuggestion: suggestion.id,
      remainingCount: updatedSuggestions.length,
      positionUpdates: updatedSuggestions.map((s: Suggestion) => ({
        id: s.id,
        type: s.type,
        original: s.original,
        position: s.position,
        textAtPosition: newText.substring(s.position.start, s.position.end)
      }))
    })

    setSuggestions(updatedSuggestions)
    setSelectedSuggestion(null)
    
    // Clear analysis window after applying suggestion
    setAnalysisWindow(null)

    toast({
      title: "Suggestion applied",
      description: "The suggestion has been applied to your text.",
    })
  }

  const dismissSuggestion = (suggestionId: string) => {
    const dismissedSuggestion = suggestions.find(s => s.id === suggestionId)
    console.log("🗑️ Dismissing suggestion:", {
      id: suggestionId,
      type: dismissedSuggestion?.type,
      original: dismissedSuggestion?.original,
      position: dismissedSuggestion?.position,
      remainingAfterDismissal: suggestions.length - 1
    })
    
    setSuggestions(suggestions.filter((s) => s.id !== suggestionId))
    if (selectedSuggestion?.id === suggestionId) {
      setSelectedSuggestion(null)
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case "grammar":
        return "text-blue-500 border-blue-500 bg-blue-500/10"
      case "tone":
        return "text-purple-500 border-purple-500 bg-purple-500/10"
      case "persuasion":
        return "text-amber-500 border-amber-500 bg-amber-500/10"
      default:
        return "text-gray-500 border-gray-500 bg-gray-500/10"
    }
  }

  const getHighlightColor = (type: string) => {
    switch (type) {
      case "grammar":
        return "bg-blue-200 dark:bg-blue-800/50"
      case "tone":
        return "bg-purple-200 dark:bg-purple-800/50"
      case "persuasion":
        return "bg-amber-200 dark:bg-amber-800/50"
      default:
        return "bg-gray-200 dark:bg-gray-800/50"
    }
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex-1">
        <div className="relative rounded-md border">
          {/* Highlight overlay */}
          <div
            ref={highlightRef}
            className="absolute inset-0 pointer-events-none overflow-hidden whitespace-pre-wrap break-words text-transparent resize-none"
            style={{
              font: 'inherit',
              fontSize: 'inherit',
              fontFamily: 'inherit',
              lineHeight: 'inherit',
              letterSpacing: 'inherit',
              wordSpacing: 'inherit',
              textIndent: 'inherit',
              padding: 'inherit',
              border: 'inherit',
              margin: 'inherit',
              boxSizing: 'border-box'
            }}
          >
            {renderHighlightedText()}
          </div>
          
          {/* Main textarea */}
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            placeholder="Start writing your marketing content here..."
            className="min-h-[500px] resize-none p-4 text-base leading-relaxed relative z-10 bg-transparent"
            style={{ caretColor: 'currentColor' }}
          />
          
          {analyzing && (
            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground z-20">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
            </div>
          )}
          
          {analysisWindow && !analyzing && !selectedSuggestion && (
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md bg-blue-100 dark:bg-blue-900/30 px-3 py-1 text-sm text-blue-700 dark:text-blue-300 z-20">
              <Sparkles className="h-3 w-3" />
              Analysis area highlighted
            </div>
          )}
          
          {suggestions.length > 0 && (
            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-md bg-gradient-to-r from-blue-100 via-purple-100 to-amber-100 dark:from-blue-900/30 dark:via-purple-900/30 dark:to-amber-900/30 px-3 py-1 text-sm text-gray-700 dark:text-gray-300 z-20">
              <Sparkles className="h-3 w-3" />
              {suggestions.length} suggestion{suggestions.length > 1 ? 's' : ''} highlighted
              {selectedSuggestion && (
                <span className="ml-1 text-xs opacity-75">
                  ({selectedSuggestion.type} selected)
                </span>
              )}
            </div>
          )}
          

        </div>
      </div>

      <div className="w-full md:w-80">
        <div className="rounded-md border">
          <div className="flex items-center justify-between border-b p-3">
            <h3 className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Suggestions
            </h3>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => analyzeText(value, cursorPosition)}
                    disabled={analyzing}
                  >
                    {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Analyze text</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="h-[500px] overflow-auto p-3">
            {suggestions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <MessageSquare className="mb-2 h-10 w-10 text-muted-foreground/50" />
                <p>No suggestions yet.</p>
                <p className="mt-1 text-xs">Start writing or click the analyze button to get suggestions.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className={cn(
                      "cursor-pointer rounded-md border p-3 transition-colors hover:bg-muted/50",
                      selectedSuggestion?.id === suggestion.id ? "border-primary/50 bg-muted" : "",
                    )}
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs font-medium",
                          getTypeColor(suggestion.type),
                        )}
                      >
                        {suggestion.type}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation()
                          dismissSuggestion(suggestion.id)
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-sm line-through">{suggestion.original}</p>
                    <p className="mt-1 text-sm font-medium text-primary">{suggestion.suggested}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedSuggestion && (
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4 shadow-lg md:left-auto md:right-6 md:bottom-6 md:w-96 md:rounded-lg md:border">
          <div className="mb-2 flex items-center justify-between">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium",
                getTypeColor(selectedSuggestion.type),
              )}
            >
              {selectedSuggestion.type}
            </span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setSelectedSuggestion(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mb-3 space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Original:</p>
              <p className="text-sm line-through">{selectedSuggestion.original}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Suggested:</p>
              <p className="text-sm font-medium">{selectedSuggestion.suggested}</p>
            </div>
          </div>
          <div className="mb-4">
            <p className="text-xs text-muted-foreground">Explanation:</p>
            <p className="text-sm">{selectedSuggestion.explanation}</p>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => applySuggestion(selectedSuggestion)}>
              Apply Suggestion
            </Button>
            <Button variant="outline" onClick={() => dismissSuggestion(selectedSuggestion.id)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
