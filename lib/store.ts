import { create } from "zustand"
import { persist } from "zustand/middleware"

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

interface EditorState {
  content: string
  title: string
  suggestions: Suggestion[]
  selectedSuggestion: Suggestion | null
  isAnalyzing: boolean
  setContent: (content: string) => void
  setTitle: (title: string) => void
  setSuggestions: (suggestions: Suggestion[]) => void
  setSelectedSuggestion: (suggestion: Suggestion | null) => void
  setIsAnalyzing: (isAnalyzing: boolean) => void
  applySuggestion: (suggestion: Suggestion) => void
  dismissSuggestion: (suggestionId: string) => void
  reset: () => void
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      content: "",
      title: "Untitled Document",
      suggestions: [],
      selectedSuggestion: null,
      isAnalyzing: false,
      setContent: (content) => set({ content }),
      setTitle: (title) => set({ title }),
      setSuggestions: (suggestions) => set({ suggestions }),
      setSelectedSuggestion: (suggestion) => set({ selectedSuggestion: suggestion }),
      setIsAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
      applySuggestion: (suggestion) => {
        const { content } = get()
        const newContent =
          content.substring(0, suggestion.position.start) +
          suggestion.suggested +
          content.substring(suggestion.position.end)

        set({
          content: newContent,
          suggestions: get().suggestions.filter((s) => s.id !== suggestion.id),
          selectedSuggestion: null,
        })
      },
      dismissSuggestion: (suggestionId) => {
        set({
          suggestions: get().suggestions.filter((s) => s.id !== suggestionId),
          selectedSuggestion: get().selectedSuggestion?.id === suggestionId ? null : get().selectedSuggestion,
        })
      },
      reset: () => {
        set({
          content: "",
          title: "Untitled Document",
          suggestions: [],
          selectedSuggestion: null,
          isAnalyzing: false,
        })
      },
    }),
    {
      name: "editor-storage",
    },
  ),
)
