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
import { useAnalytics } from "@/hooks/use-analytics"

// Dynamic import for client-side spell checking library
let typoModule: any = null

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
  documentId?: string
}

export function Editor({ content, onChange, documentId }: EditorProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { 
    startSession,
    currentSession,
    trackWordsWritten, 
    trackSuggestionShown, 
    trackSuggestionAction,
    userAnalytics 
  } = useAnalytics({ enableSessionManagement: true })
  
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
    writingGoals: ["clarity", "persuasion", "grammar", "tone", "brevity", "consistency"]
  })
  
  // Analytics tracking refs
  const wordCountRef = useRef(0)
  const suggestionTimestamps = useRef<Record<string, number>>({})
  
  // Track if auto-analysis has been done for current document to prevent loops
  const autoAnalysisCompleted = useRef<boolean>(false)
  const lastDocumentId = useRef<string | undefined>(undefined)
  
  const editorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setValue(content)
    setPreviousText(content)
  }, [content])

  // Initialize contentEditable content
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.textContent === value) return
    
    editor.textContent = value
  }, []) // Only run on mount

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
            writingGoals: data.writingGoals || ["clarity", "persuasion", "grammar", "tone", "brevity", "consistency"]
          })
        }
      } catch (error) {
        console.error("Error fetching user settings:", error)
        // Keep default settings on error
      }
    }

    fetchUserSettings()
  }, [user])

  // Auto-analyze existing content when document is opened
  useEffect(() => {
    // Reset auto-analysis flag when document changes
    if (lastDocumentId.current !== documentId) {
      lastDocumentId.current = documentId
      autoAnalysisCompleted.current = false
    }
    
    // Only analyze if:
    // 1. There's meaningful content (more than 10 characters)
    // 2. User settings are loaded
    // 3. User is authenticated
    // 4. Content is not empty or just whitespace
    // 5. We haven't already auto-analyzed this document
    // 6. We're not currently analyzing
    if (
      content && 
      content.trim().length > 10 && 
      user && 
      userSettings.preferredTone && 
      !autoAnalysisCompleted.current &&
      !analyzing
    ) {
      console.log(`📄 Document opened with existing content (${documentId || 'no-id'}), auto-analyzing...`)
      
      // Mark this document as being auto-analyzed to prevent loops
      autoAnalysisCompleted.current = true
      
      // Add a small delay to ensure UI is ready
      const timeout = setTimeout(() => {
        analyzeTextAutomatic(content)
      }, 500)

      return () => clearTimeout(timeout)
    }
  }, [content, documentId, user, userSettings.preferredTone])

  // Handle cursor position tracking for contentEditable
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0)
        const textContent = editor.textContent || ''
        
        // Calculate cursor position in text
        const preCaretRange = range.cloneRange()
        preCaretRange.selectNodeContents(editor)
        preCaretRange.setEnd(range.endContainer, range.endOffset)
        const cursorPos = preCaretRange.toString().length
        
        setCursorPosition(cursorPos)
      }
    }

        document.addEventListener('selectionchange', handleSelectionChange)
    
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [])

  // Handle clicks on highlighted suggestions
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const suggestionId = target.getAttribute('data-suggestion-id')
      
      if (suggestionId) {
        e.preventDefault()
        const suggestion = suggestions.find(s => s.id === suggestionId)
        if (suggestion) {
          handleSuggestionClick(suggestion)
        }
      }
    }

    editor.addEventListener('click', handleClick)
    
    return () => {
      editor.removeEventListener('click', handleClick)
    }
  }, [suggestions])

  // Track if user is currently typing to avoid cursor interference
  const [isTyping, setIsTyping] = useState(false)

  // Manage contentEditable content updates (only when not actively typing)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || isTyping) return // Don't interfere while user is typing

    // Save current cursor position
    const selection = window.getSelection()
    let cursorOffset = 0
    
    if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0)
      const preCaretRange = range.cloneRange()
      preCaretRange.selectNodeContents(editor)
      preCaretRange.setEnd(range.endContainer, range.endOffset)
      cursorOffset = preCaretRange.toString().length
    }

    // Update content to show highlights when not typing
    const targetHTML = suggestions.length > 0 ? renderHighlightedHTML() : escapeHtml(value)
    
    if (editor.innerHTML !== targetHTML) {
      editor.innerHTML = targetHTML
      
      // Restore cursor position after content update
      setTimeout(() => {
        restoreCursorPosition(cursorOffset)
      }, 0)
    }
  }, [value, suggestions, isTyping])

  const restoreCursorPosition = (targetOffset: number) => {
    const editor = editorRef.current
    if (!editor) return

    const selection = window.getSelection()
    if (!selection) return

    try {
      // Walk through text nodes to find the target position
      const walker = document.createTreeWalker(
        editor,
        NodeFilter.SHOW_TEXT,
        null
      )

      let currentOffset = 0
      let targetNode = null
      let targetNodeOffset = 0

      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text
        const textLength = textNode.textContent?.length || 0

        if (currentOffset + textLength >= targetOffset) {
          targetNode = textNode
          targetNodeOffset = targetOffset - currentOffset
          break
        }
        currentOffset += textLength
      }

      if (targetNode) {
        const range = document.createRange()
        range.setStart(targetNode, Math.min(targetNodeOffset, targetNode.textContent?.length || 0))
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    } catch (e) {
      console.log('Could not restore cursor position:', e)
    }
  }

  const getContextualWindow = (text: string, cursorPos: number) => {
    // Return the entire text for analysis
    return {
      text: text,
      startOffset: 0,
      endOffset: text.length
    }
  }

  const determineContextCategory = (position: number, text: string): string => {
    const textLength = text.length
    const relativePosition = position / textLength
    
    if (relativePosition < 0.2) return 'introduction'
    if (relativePosition > 0.8) return 'conclusion'
    return 'body'
  }

  const renderHighlightedText = () => {
    if (!value) {
      return (
        <span className="text-gray-400 pointer-events-none select-none">
          Start writing your marketing content here...
        </span>
      )
    }

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

  const renderHighlightedHTML = (): string => {
    if (!value) {
      return '' // Return empty string, placeholder will be handled by CSS
    }

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
        }
      }
    })

    // If no highlights, return plain text
    if (highlights.length === 0) {
      return escapeHtml(value)
    }

    // Sort highlights by priority and position
    highlights.sort((a, b) => b.priority - a.priority || a.start - b.start)

    // Create HTML string with highlights
    let html = ''
    let currentPos = 0

    // Use the highest priority highlight that overlaps with each position
    for (let i = 0; i < value.length; i++) {
      const applicableHighlight = highlights.find(h => i >= h.start && i < h.end)
      
      if (applicableHighlight) {
        // Add any plain text before this highlight
        if (currentPos < applicableHighlight.start) {
          html += escapeHtml(value.substring(currentPos, applicableHighlight.start))
        }

        // Add the highlighted text
        const suggestionData = applicableHighlight.suggestion 
          ? ` data-suggestion-id="${applicableHighlight.suggestion.id}" title="${escapeHtml(applicableHighlight.suggestion.type)}: ${escapeHtml(applicableHighlight.suggestion.explanation)}"` 
          : ''
        
        html += `<span class="${applicableHighlight.className}"${suggestionData}>${escapeHtml(value.substring(applicableHighlight.start, applicableHighlight.end))}</span>`

        // Move current position to end of this highlight
        currentPos = applicableHighlight.end
        i = applicableHighlight.end - 1 // -1 because loop will increment
      }
    }

    // Add any remaining plain text
    if (currentPos < value.length) {
      html += escapeHtml(value.substring(currentPos))
    }

    return html
  }

  const escapeHtml = (text: string): string => {
    // Server-safe HTML escaping
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\n/g, '<br/>')
  }

    const handleContentEditable = (e: React.FormEvent<HTMLDivElement>) => {
    const editor = e.currentTarget
    const newValue = editor.textContent || ''
    const oldValue = previousText
    
    // Only proceed if content actually changed
    if (newValue === oldValue) return
    
    // Start a writing session if user starts writing and no session is active
    if (!currentSession && user && newValue.trim().length > 0) {
              startSession?.().catch(console.error)
    }
    
    // Mark as typing to prevent cursor interference
    setIsTyping(true)
    
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
    setPreviousText(newValue)

    // Track words written for analytics
    const oldWordCount = oldValue.trim().split(/\s+/).filter(word => word.length > 0).length
    const newWordCount = newValue.trim().split(/\s+/).filter(word => word.length > 0).length
    const wordsAdded = Math.max(0, newWordCount - oldWordCount)
    
    if (wordsAdded > 0 && documentId) {
              trackWordsWritten?.(wordsAdded, documentId).catch(console.error)
    }
    
    wordCountRef.current = newWordCount

    // Update suggestion positions based on the text change
    if (suggestions.length > 0) {
      updateSuggestionPositions(oldValue, newValue, changeStart)
    }

          // Clear previous timeout and analysis window
      if (typingTimeout) {
        clearTimeout(typingTimeout)
      }
      setAnalysisWindow(null)

      // Clear all suggestions if text is empty
      if (newValue.trim().length === 0) {
        setSuggestions([])
      }

      // Set new timeout to analyze text after user stops typing
      const timeout = setTimeout(() => {
        setIsTyping(false) // Stop typing mode before analysis
        analyzeTextAutomatic(newValue)
      }, 2000)

    setTypingTimeout(timeout)
    
    // Clear typing state after a shorter delay for immediate feedback
    setTimeout(() => {
      setIsTyping(false)
    }, 500) // Balanced delay for typing experience
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Handle special key combinations
    if (e.key === 'Tab') {
      e.preventDefault()
      insertTextAtCursor('\t')
    }
    
    // Handle Enter key to ensure proper line breaks
    if (e.key === 'Enter') {
      e.preventDefault()
      insertTextAtCursor('\n')
    }
    
    // Show highlights immediately when user navigates (doesn't change content)
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      setIsTyping(false)
    }
    
    // Show highlights when user presses Escape (common UI pattern)
    if (e.key === 'Escape') {
      setIsTyping(false)
    }
  }

  const insertTextAtCursor = (text: string) => {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0)
      range.deleteContents()
      
      const textNode = document.createTextNode(text)
      range.insertNode(textNode)
      
      // Move cursor after inserted text
      range.setStartAfter(textNode)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
      
      // Trigger input event to update state
      if (editorRef.current) {
        editorRef.current.dispatchEvent(new Event('input', { bubbles: true }))
      }
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // This function is now replaced by handleContentEditable
    // Keeping for backward compatibility if needed
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart
    const oldValue = previousText
    
    // Start a writing session if user starts writing and no session is active
    if (!currentSession && user && newValue.trim().length > 0) {
      startSession?.().catch(console.error)
    }
    
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
      analyzeTextAutomatic(newValue)
    }, 2000)

    setTypingTimeout(timeout)
  }

  // Function to load Typo.js dynamically
  const loadTextCheckers = async () => {
    if (!typoModule) {
      try {
        // Load Typo.js library
        const typoImport = await import('typo-js' as any)
        typoModule = typoImport.default || typoImport
        
        console.log("✅ Loaded Typo.js spell checking library successfully")
      } catch (error) {
        console.error("Failed to load Typo.js library:", error)
        throw error
      }
    }
    return { typo: typoModule }
  }

  // Intelligent suggestion merging - keeps existing valid suggestions and adds new ones
  const mergeSuggestionsIntelligently = (
    existingSuggestions: Suggestion[], 
    newSuggestions: Suggestion[], 
    currentText: string
  ): Suggestion[] => {
    console.log("🔄 Merging suggestions intelligently...")
    
    // 1. Filter out existing suggestions that are no longer valid (text changed)
    const validExistingSuggestions = existingSuggestions.filter(suggestion => {
      const currentTextAtPosition = currentText.substring(
        suggestion.position.start, 
        suggestion.position.end
      )
      const isStillValid = currentTextAtPosition === suggestion.original
      
      if (!isStillValid) {
        console.log(`❌ Removing invalid suggestion: "${suggestion.original}" (text changed to "${currentTextAtPosition}")`)
      }
      
      return isStillValid
    })
    
    // 2. Remove overlapping suggestions (newer ones take precedence)
    const mergedSuggestions: Suggestion[] = [...validExistingSuggestions]
    
    newSuggestions.forEach(newSuggestion => {
      // Check if this new suggestion overlaps with any existing ones
      const overlappingIndices: number[] = []
      
      mergedSuggestions.forEach((existingSuggestion, index) => {
        const newStart = newSuggestion.position.start
        const newEnd = newSuggestion.position.end
        const existingStart = existingSuggestion.position.start
        const existingEnd = existingSuggestion.position.end
        
        // Check for overlap
        const overlaps = (newStart < existingEnd && newEnd > existingStart)
        
        if (overlaps) {
          overlappingIndices.push(index)
          console.log(`🔄 New suggestion "${newSuggestion.original}" overlaps with existing "${existingSuggestion.original}"`)
        }
      })
      
      // Remove overlapping existing suggestions (in reverse order to maintain indices)
      overlappingIndices.reverse().forEach(index => {
        const removed = mergedSuggestions.splice(index, 1)[0]
        console.log(`❌ Removed overlapping suggestion: "${removed.original}"`)
      })
      
      // Add the new suggestion
      mergedSuggestions.push(newSuggestion)
      console.log(`✅ Added new suggestion: "${newSuggestion.original}"`)
    })
    
    // 3. Sort suggestions by position for consistent ordering
    mergedSuggestions.sort((a, b) => a.position.start - b.position.start)
    
    console.log(`📊 Merge complete: ${validExistingSuggestions.length} valid existing + ${newSuggestions.length} new = ${mergedSuggestions.length} total`)
    
    return mergedSuggestions
  }

    // Fast automatic analysis: immediate Typo.js + background OpenAI
  const analyzeTextAutomatic = async (text: string) => {
    if (!text || text.length < 5) {
      setSuggestions([])
      setAnalysisWindow(null)
      return
    }

    console.log("🔍 Running immediate Typo.js analysis + background OpenAI")
    setAnalyzing(true)
    
    try {
      let suggestionIdCounter = 0
      
      // 1. IMMEDIATE TYPO.JS SPELL CHECKING
      const typoSuggestions: Suggestion[] = []
      try {
        // Load Typo.js library dynamically
        const { typo: Typo } = await loadTextCheckers()
        
        // Initialize Typo.js dictionary for spellchecking
        let dictionary: any = null
        try {
          const [affData, dicData] = await Promise.all([
            fetch('/dictionaries/en_US.aff').then(res => res.text()),
            fetch('/dictionaries/en_US.dic').then(res => res.text())
          ])
          
          dictionary = new Typo("en_US", affData, dicData)
          console.log("✅ Initialized Typo.js dictionary")
        } catch (error) {
          console.log("ℹ️ Typo.js dictionary not available")
        }
        
        if (dictionary) {
          const words = text.match(/\b[a-zA-Z]+\b/g) || []
          const uniqueWords = [...new Set(words)]
          
          console.log(`🔤 Spellchecking ${uniqueWords.length} unique words`)
          
          uniqueWords.forEach((word) => {
            if (word.length < 2) return
            
            const isCorrect = dictionary.check(word)
            if (!isCorrect) {
              const suggestions = dictionary.suggest(word, 3)
              if (suggestions && suggestions.length > 0) {
                let searchIndex = text.indexOf(word)
                while (searchIndex !== -1) {
                  const suggestion: Suggestion = {
                    id: `typo-${suggestionIdCounter++}-${Date.now()}`,
                    type: "grammar",
                    position: {
                      start: searchIndex,
                      end: searchIndex + word.length
                    },
                    original: word,
                    suggested: suggestions[0],
                    contextBefore: getContextBefore(text, searchIndex),
                    contextAfter: getContextAfter(text, searchIndex + word.length),
                    explanation: `Spelling: "${word}" may be misspelled. Did you mean "${suggestions[0]}"?`,
                    confidence: 0.8
                  }
                  
                  typoSuggestions.push(suggestion)
                  searchIndex = text.indexOf(word, searchIndex + 1)
                }
              }
            }
          })
        }
      } catch (error) {
        console.log("⚠️ Typo.js analysis failed:", error)
      }
      
      // 2. IMMEDIATELY SHOW TYPO.JS SUGGESTIONS
      if (typoSuggestions.length > 0) {
        const mergedWithTypo = mergeSuggestionsIntelligently(suggestions, typoSuggestions, text)
        setSuggestions(mergedWithTypo)
        
        console.log(`⚡ Immediate: Added ${typoSuggestions.length} Typo.js suggestions`)
        
        // Track immediate suggestions for analytics
        const newTypoSuggestions = mergedWithTypo.filter((s: Suggestion) => 
          !suggestions.some(existing => existing.id === s.id)
        )
        
        if (newTypoSuggestions.length > 0 && documentId) {
          newTypoSuggestions.forEach((suggestion: Suggestion) => {
            suggestionTimestamps.current[suggestion.id] = Date.now()
            trackSuggestionShown?.(suggestion.id, {
              type: suggestion.type,
              confidence: suggestion.confidence,
              documentId,
              textLength: suggestion.original.length,
              contextCategory: determineContextCategory(suggestion.position.start, text)
            }).catch(console.error)
          })
        }
      }

      // 3. BACKGROUND OPENAI API ANALYSIS
      console.log("🧠 Starting background OpenAI analysis...")
      
      // Don't await this - let it run in background
      fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          preferredTone: userSettings.preferredTone,
          writingGoals: userSettings.writingGoals
        }),
      })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          
          if (data.suggestions && Array.isArray(data.suggestions)) {
            // Correct OpenAI suggestion positions
            const correctedOpenAISuggestions = data.suggestions
              .map((suggestion: Suggestion): Suggestion | null => {
                const exactPosition = findExactTextPosition(
                  text,
                  suggestion.original,
                  suggestion.position.start,
                  suggestion.position.end,
                  suggestion.contextBefore,
                  suggestion.contextAfter
                )

                if (exactPosition.found) {
                  return {
                    ...suggestion,
                    id: `openai-${suggestionIdCounter++}-${Date.now()}`,
                    position: {
                      start: exactPosition.start,
                      end: exactPosition.end
                    }
                  }
                } else {
                  console.log(`❌ Could not locate OpenAI suggestion: "${suggestion.original}"`)
                  return null
                }
              })
              .filter((s: Suggestion | null): s is Suggestion => s !== null)

            if (correctedOpenAISuggestions.length > 0) {
              // Merge OpenAI suggestions with current suggestions
              setSuggestions(currentSuggestions => {
                const merged = mergeSuggestionsIntelligently(currentSuggestions, correctedOpenAISuggestions, text)
                console.log(`🧠 Background: Added ${correctedOpenAISuggestions.length} OpenAI suggestions`)
                return merged
              })
              
              // Track OpenAI suggestions for analytics
              if (documentId) {
                correctedOpenAISuggestions.forEach((suggestion: Suggestion) => {
                  suggestionTimestamps.current[suggestion.id] = Date.now()
                  trackSuggestionShown?.(suggestion.id, {
                    type: suggestion.type,
                    confidence: suggestion.confidence,
                    documentId,
                    textLength: suggestion.original.length,
                    contextCategory: determineContextCategory(suggestion.position.start, text)
                  }).catch(console.error)
                })
              }
            }
          }
        } else {
          console.log("⚠️ OpenAI API request failed:", response.status)
        }
      })
      .catch((error) => {
        console.log("⚠️ Background OpenAI analysis failed:", error)
      })
      .finally(() => {
        // Stop analyzing spinner when OpenAI analysis is complete (success or failure)
        setAnalyzing(false)
        console.log("🔄 Analysis complete - spinner stopped")
      })

    } catch (error) {
      console.error("Error with automatic analysis:", error)
      // Don't show error toast for automatic analysis to avoid interrupting user
      setAnalyzing(false) // Stop spinner on immediate error
    }
  }

  // Comprehensive analysis using OpenAI for manual analysis button
  const analyzeTextManual = async (text: string, cursorPos: number = cursorPosition) => {
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

    console.log("🧠 Running comprehensive analysis with OpenAI")
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
      console.log("🎯 OpenAI suggestions received:", adjustedSuggestions.length)
      console.log("✅ Suggestions with corrected positions:", correctedSuggestions.length)
      console.log("📍 Final suggestion positions:", correctedSuggestions.map((s: Suggestion) => ({
        id: s.id,
        type: s.type,
        original: s.original,
        suggested: s.suggested,
        position: s.position,
        textAtPosition: text.substring(s.position.start, s.position.end)
      })))

      // Use intelligent merging for manual analysis too
      const mergedSuggestions = mergeSuggestionsIntelligently(suggestions, correctedSuggestions, text)
      setSuggestions(mergedSuggestions)
      
      // Track new suggestions for analytics
      const newSuggestionsFromManual = mergedSuggestions.filter((s: Suggestion) => 
        !suggestions.some(existing => existing.id === s.id)
      )
      
      if (newSuggestionsFromManual.length > 0 && documentId) {
        newSuggestionsFromManual.forEach((suggestion: Suggestion) => {
          // Record when suggestion was shown
          suggestionTimestamps.current[suggestion.id] = Date.now()
          
          // Track suggestion shown in analytics
          trackSuggestionShown?.(suggestion.id, {
            type: suggestion.type,
            confidence: suggestion.confidence,
            documentId,
            textLength: suggestion.original.length,
            contextCategory: determineContextCategory(suggestion.position.start, text)
          }).catch(console.error)
        })
      }
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
    if (editorRef.current) {
      editorRef.current.focus()
      
      // Set cursor position in contentEditable div
      const range = document.createRange()
      const selection = window.getSelection()
      
      if (selection) {
        // Find the text node and position
        const walker = document.createTreeWalker(
          editorRef.current,
          NodeFilter.SHOW_TEXT,
          null
        )
        
        let currentPos = 0
        let targetNode = null
        let targetOffset = 0
        
        while (walker.nextNode()) {
          const textNode = walker.currentNode as Text
          const textLength = textNode.textContent?.length || 0
          
          if (currentPos + textLength >= exactPosition.start) {
            targetNode = textNode
            targetOffset = exactPosition.start - currentPos
            break
          }
          currentPos += textLength
        }
        
        if (targetNode) {
          range.setStart(targetNode, targetOffset)
          range.setEnd(targetNode, targetOffset)
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }
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
    if (!editorRef.current) return

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
    
    // Track suggestion acceptance for analytics
    const responseTime = suggestionTimestamps.current[suggestion.id] 
      ? (Date.now() - suggestionTimestamps.current[suggestion.id]) / 1000 
      : 0
    
    if (documentId) {
      trackSuggestionAction?.(suggestion.id, 'accepted', responseTime).catch(console.error)
    }
    
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
    
    // Track suggestion dismissal for analytics
    const responseTime = suggestionTimestamps.current[suggestionId] 
      ? (Date.now() - suggestionTimestamps.current[suggestionId]) / 1000 
      : 0
    
    if (documentId) {
      trackSuggestionAction?.(suggestionId, 'dismissed', responseTime).catch(console.error)
    }
    
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
                    {/* Single ContentEditable div with managed content updates */}
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning={true}
            onInput={handleContentEditable}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              // Don't immediately clear typing state on focus
            }}
            onBlur={() => {
              setIsTyping(false) // Always clear typing state when editor loses focus
            }}
            className={cn(
              "min-h-[500px] resize-none p-4 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-background",
              !value && "before:content-[attr(data-placeholder)] before:text-muted-foreground before:pointer-events-none before:absolute"
            )}
            style={{ 
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word'
            }}
            data-placeholder="Start writing your marketing content here..."
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
                    onClick={() => analyzeTextManual(value, cursorPosition)}
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

// Helper functions for client-side grammarify processing
type TextSegment = {
  text: string
  startIndex: number
  endIndex: number
}

function splitTextIntoSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  
  // Split by double newlines first (paragraphs)
  const paragraphs = text.split(/\n\s*\n/)
  let currentIndex = 0
  
  for (const paragraph of paragraphs) {
    if (paragraph.trim().length === 0) {
      currentIndex += paragraph.length + 2 // Account for the double newline
      continue
    }
    
    // Find the actual start position of this paragraph in the original text
    const paragraphStart = text.indexOf(paragraph, currentIndex)
    
    // Split paragraph into sentences
    const sentences = splitIntoSentences(paragraph)
    let sentenceStartInParagraph = 0
    
    for (const sentence of sentences) {
      if (sentence.trim().length < 3) {
        sentenceStartInParagraph += sentence.length
        continue
      }
      
      // Find the position of this sentence within the paragraph
      const sentenceStart = paragraph.indexOf(sentence, sentenceStartInParagraph)
      const actualStart = paragraphStart + sentenceStart
      const actualEnd = actualStart + sentence.length
      
      segments.push({
        text: sentence,
        startIndex: actualStart,
        endIndex: actualEnd
      })
      
      sentenceStartInParagraph = sentenceStart + sentence.length
    }
    
    currentIndex = paragraphStart + paragraph.length + 2 // Move past this paragraph and newlines
  }
  
  // If no segments were created (single paragraph, no clear sentences), use the whole text
  if (segments.length === 0) {
    segments.push({
      text: text,
      startIndex: 0,
      endIndex: text.length
    })
  }
  
  return segments
}

function splitIntoSentences(text: string): string[] {
  // Split on sentence endings, but be careful with abbreviations and numbers
  const sentences: string[] = []
  const sentenceEnders = /[.!?]+/g
  let lastIndex = 0
  let match
  
  while ((match = sentenceEnders.exec(text)) !== null) {
    const endIndex = match.index + match[0].length
    const potentialSentence = text.substring(lastIndex, endIndex).trim()
    
    // Check if this is likely a real sentence ending (not an abbreviation or decimal)
    const nextChar = text[endIndex]
    const prevChar = text[match.index - 1]
    
    // Simple heuristics to avoid splitting on abbreviations or decimals
    const isLikelyAbbreviation = prevChar && prevChar.match(/[A-Z]/) && potentialSentence.length < 10
    const isDecimal = prevChar && prevChar.match(/\d/) && nextChar && nextChar.match(/\d/)
    
    if (!isLikelyAbbreviation && !isDecimal && (nextChar === undefined || nextChar.match(/\s/) || nextChar.match(/[A-Z]/))) {
      if (potentialSentence.length > 0) {
        sentences.push(potentialSentence)
      }
      lastIndex = endIndex
    }
  }
  
  // Add any remaining text as a sentence
  const remaining = text.substring(lastIndex).trim()
  if (remaining.length > 0) {
    sentences.push(remaining)
  }
  
  return sentences.length > 0 ? sentences : [text] // Fallback to whole text if no sentences found
}

// IMPROVED text difference detection algorithm
function findImprovedTextDifferences(original: string, cleaned: string) {
  const diffs = []
  
  // Use a more sophisticated word-boundary aware algorithm
  const originalWords = tokenizeText(original)
  const cleanedWords = tokenizeText(cleaned)
  
  // Find differences using a simple LCS-like approach
  let origIndex = 0
  let cleanIndex = 0
  
  while (origIndex < originalWords.length || cleanIndex < cleanedWords.length) {
    // If we've reached the end of one array
    if (origIndex >= originalWords.length) {
      // All remaining cleaned words are additions
      const addedText = cleanedWords.slice(cleanIndex).map(w => w.text).join('')
      if (addedText.trim()) {
        diffs.push({
          start: original.length,
          end: original.length,
          original: '',
          suggested: addedText
        })
      }
      break
    }
    
    if (cleanIndex >= cleanedWords.length) {
      // All remaining original words are deletions
      const deletedText = originalWords.slice(origIndex).map(w => w.text).join('')
      const startPos = originalWords[origIndex].start
      if (isValidDifference(deletedText, '')) {
        diffs.push({
          start: startPos,
          end: original.length,
          original: deletedText,
          suggested: ''
        })
      }
      break
    }
    
    const origWord = originalWords[origIndex]
    const cleanWord = cleanedWords[cleanIndex]
    
    // If words match exactly, continue
    if (origWord.text === cleanWord.text) {
      origIndex++
      cleanIndex++
      continue
    }
    
    // Look ahead to find the next matching point
    let matchFound = false
    const lookAhead = 3 // How many words to look ahead
    
    for (let i = 1; i <= lookAhead && !matchFound; i++) {
      // Check if original[origIndex] matches cleaned[cleanIndex + i]
      if (cleanIndex + i < cleanedWords.length && 
          origWord.text === cleanedWords[cleanIndex + i].text) {
        // Found a match - words were inserted in cleaned
        const insertedText = cleanedWords.slice(cleanIndex, cleanIndex + i).map(w => w.text).join('')
        if (insertedText.trim() && isValidDifference('', insertedText)) {
          diffs.push({
            start: origWord.start,
            end: origWord.start,
            original: '',
            suggested: insertedText
          })
        }
        cleanIndex += i
        matchFound = true
        break
      }
      
      // Check if original[origIndex + i] matches cleaned[cleanIndex]
      if (origIndex + i < originalWords.length && 
          originalWords[origIndex + i].text === cleanWord.text) {
        // Found a match - words were deleted from original
        const deletedText = originalWords.slice(origIndex, origIndex + i).map(w => w.text).join('')
        const startPos = origWord.start
        const endPos = originalWords[origIndex + i - 1].end
        if (isValidDifference(deletedText, '')) {
          diffs.push({
            start: startPos,
            end: endPos,
            original: deletedText,
            suggested: ''
          })
        }
        origIndex += i
        matchFound = true
        break
      }
    }
    
    if (!matchFound) {
      // Direct substitution - find the extent of the change
      let origEndIndex = origIndex + 1
      let cleanEndIndex = cleanIndex + 1
      
      // Create the substitution diff
      const originalText = originalWords.slice(origIndex, origEndIndex).map(w => w.text).join('')
      const suggestedText = cleanedWords.slice(cleanIndex, cleanEndIndex).map(w => w.text).join('')
      
      if (isValidDifference(originalText, suggestedText)) {
        diffs.push({
          start: origWord.start,
          end: originalWords[origEndIndex - 1]?.end || origWord.end,
          original: originalText,
          suggested: suggestedText
        })
      }
      
      origIndex = origEndIndex
      cleanIndex = cleanEndIndex
    }
  }
  
  return consolidateDifferences(diffs)
}

function tokenizeText(text: string) {
  const tokens = []
  const wordRegex = /\S+|\s+/g
  let match
  
  while ((match = wordRegex.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length
    })
  }
  
  return tokens
}

function isValidDifference(original: string, suggested: string): boolean {
  // Filter out questionable suggestions
  
  // Don't suggest single character removals unless it's clearly whitespace or punctuation
  if (original.length === 1 && suggested === '') {
    return /[\s.!?'"(),-]/.test(original) // Only allow removing whitespace or punctuation
  }
  
  // Don't suggest adding single characters unless it's meaningful punctuation
  if (suggested.length === 1 && original === '') {
    return /[.!?'"(),]/.test(suggested) // Only allow adding punctuation
  }
  
  // Don't suggest changes that are too small and unclear
  if (original.length <= 2 && suggested.length <= 2 && 
      !original.includes(' ') && !suggested.includes(' ')) {
    // Only allow if it's a clear spelling correction or meaningful change
    const lengthDiff = Math.abs(original.length - suggested.length)
    if (lengthDiff > 1) return false
    
    // Allow if it's a common word correction
    const corrections: { [key: string]: string } = {
      'im': "I'm", 'dont': "don't", 'cant': "can't", 'wont': "won't",
      'its': "it's", 'youre': "you're", 'theyre': "they're"
    }
    if (corrections[original.toLowerCase()] === suggested) return true
  }
  
  // Don't create suggestions for very small fragments
  if (original.length < 2 && suggested.length < 2) {
    return false
  }
  
  // Allow meaningful changes
  return original !== suggested
}

function consolidateDifferences(diffs: Array<{start: number, end: number, original: string, suggested: string}>) {
  if (diffs.length <= 1) return diffs
  
  // Sort by position
  diffs.sort((a, b) => a.start - b.start)
  
  const consolidated = []
  let current = diffs[0]
  
  for (let i = 1; i < diffs.length; i++) {
    const next = diffs[i]
    
    // If diffs are very close together (within 2 characters), consider consolidating
    if (next.start - current.end <= 2) {
      // Get the text between the two changes
      // For now, keep them separate to maintain clarity
      consolidated.push(current)
      current = next
    } else {
      consolidated.push(current)
      current = next
    }
  }
  
  consolidated.push(current)
  return consolidated
}

function getGrammarifyContextBefore(text: string, position: number, contextLength: number = 20): string {
  const start = Math.max(0, position - contextLength)
  return text.substring(start, position).trim()
}

function getGrammarifyContextAfter(text: string, position: number, contextLength: number = 20): string {
  const end = Math.min(text.length, position + contextLength)
  return text.substring(position, end).trim()
}

// Simple context functions for new text checkers
function getContextBefore(text: string, position: number, contextLength: number = 20): string {
  const start = Math.max(0, position - contextLength)
  return text.substring(start, position).trim()
}

function getContextAfter(text: string, position: number, contextLength: number = 20): string {
  const end = Math.min(text.length, position + contextLength)
  return text.substring(position, end).trim()
}

function getGrammarifyExplanation(original: string, suggested: string): string {
  // Provide basic explanations for common grammarify fixes
  if (original.length > suggested.length) {
    return "Removed extra spaces or characters"
  } else if (suggested.length > original.length) {
    return "Added missing punctuation or capitalization"
  } else if (original.toLowerCase() !== suggested.toLowerCase()) {
    return "Fixed capitalization"
  } else if (original !== suggested) {
    return "Corrected spelling or grammar"
  } else {
    return "General text improvement"
  }
}
