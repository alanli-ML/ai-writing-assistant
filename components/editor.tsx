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
  const [userSettings, setUserSettings] = useState<{
    preferredTone: string
    writingGoals: string[]
  }>({
    preferredTone: "professional",
    writingGoals: ["clarity", "grammar"]
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setValue(content)
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    setValue(newValue)
    onChange(newValue)

    // Clear previous timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout)
    }

    // Set new timeout to analyze text after user stops typing
    const timeout = setTimeout(() => {
      analyzeText(newValue)
    }, 2000)

    setTypingTimeout(timeout)
  }

  const analyzeText = async (text: string) => {
    if (!text || text.length < 20) {
      setSuggestions([])
      return
    }

    setAnalyzing(true)
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
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

      setSuggestions(data.suggestions || [])
    } catch (error) {
      console.error("Error analyzing text:", error)
      toast({
        variant: "destructive",
        title: "Analysis failed",
        description: "Failed to analyze your text. Please try again.",
      })
    } finally {
      setAnalyzing(false)
    }
  }

  const applySuggestion = (suggestion: Suggestion) => {
    if (!textareaRef.current) return

    const newText =
      value.substring(0, suggestion.position.start) + suggestion.suggested + value.substring(suggestion.position.end)

    setValue(newText)
    onChange(newText)

    // Remove the applied suggestion
    setSuggestions(suggestions.filter((s) => s.id !== suggestion.id))
    setSelectedSuggestion(null)

    toast({
      title: "Suggestion applied",
      description: "The suggestion has been applied to your text.",
    })
  }

  const dismissSuggestion = (suggestionId: string) => {
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

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="flex-1">
        <div className="relative rounded-md border">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            placeholder="Start writing your marketing content here..."
            className="min-h-[500px] resize-none p-4 text-base leading-relaxed"
          />
          {analyzing && (
            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-md bg-muted px-3 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
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
                    onClick={() => analyzeText(value)}
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
                    onClick={() => setSelectedSuggestion(suggestion)}
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
