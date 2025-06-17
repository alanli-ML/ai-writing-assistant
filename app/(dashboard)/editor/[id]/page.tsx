"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, collection } from "firebase/firestore"
import { Loader2, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Editor } from "@/components/editor"
import { useAuth } from "@/components/auth-provider"
import { db } from "@/components/auth-provider"

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [document, setDocument] = useState<{
    id: string
    title: string
    content: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout | null>(null)
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null)
  const [resolvedParams, setResolvedParams] = useState<{ id: string } | null>(null)

  const isNewDocument = resolvedParams?.id === "new"

  // Resolve async params
  useEffect(() => {
    params.then(setResolvedParams)
  }, [params])

  useEffect(() => {
    async function fetchDocument() {
      if (!user || !resolvedParams) return

      if (isNewDocument) {
        setDocument({
          id: "",
          title: "Untitled Document",
          content: "",
        })
        setTitle("Untitled Document")
        setContent("")
        setCurrentDocumentId(null) // No document ID yet for new documents
        setLoading(false)
        return
      }

      try {
        const docRef = doc(db, "documents", resolvedParams.id)
        const docSnap = await getDoc(docRef)

        if (docSnap.exists()) {
          const data = docSnap.data()
          if (data.uid !== user.uid) {
            toast({
              variant: "destructive",
              title: "Access denied",
              description: "You don't have permission to access this document.",
            })
            router.push("/dashboard")
            return
          }

          setDocument({
            id: docSnap.id,
            title: data.title || "Untitled Document",
            content: data.content || "",
          })
          setTitle(data.title || "Untitled Document")
          setContent(data.content || "")
          setCurrentDocumentId(docSnap.id)
        } else {
          toast({
            variant: "destructive",
            title: "Document not found",
            description: "The document you're looking for doesn't exist.",
          })
          router.push("/dashboard")
        }
      } catch (error) {
        console.error("Error fetching document:", error)
        toast({
          variant: "destructive",
          title: "Failed to load document",
          description: "Please try again later.",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchDocument()
  }, [user, resolvedParams?.id, isNewDocument, router, toast])

  useEffect(() => {
    // Auto-save functionality
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer)
    }

    if (document && (title !== document.title || content !== document.content)) {
      const timer = setTimeout(() => {
        handleSave(true)
      }, 5000) // Auto-save after 5 seconds of inactivity

      setAutoSaveTimer(timer)
    }

    return () => {
      if (autoSaveTimer) {
        clearTimeout(autoSaveTimer)
      }
    }
  }, [title, content])

  const handleSave = async (isAutoSave = false) => {
    if (!user || !resolvedParams) return

    setSaving(true)
    try {
      let docId = resolvedParams.id

      if (isNewDocument || !docId) {
        // Create a new document
        const newDocRef = doc(collection(db, "documents"))
        docId = newDocRef.id

        await setDoc(newDocRef, {
          uid: user.uid,
          title,
          content,
          timestamp: serverTimestamp(),
        })

        // Set the current document ID for analytics tracking
        setCurrentDocumentId(docId)

        // Update URL without refreshing the page
        router.replace(`/editor/${docId}`)
      } else {
        // Update existing document
        await updateDoc(doc(db, "documents", docId), {
          title,
          content,
          timestamp: serverTimestamp(),
        })
      }

      if (!isAutoSave) {
        toast({
          title: "Document saved",
          description: "Your document has been saved successfully.",
        })
      }
    } catch (error) {
      console.error("Error saving document:", error)
      toast({
        variant: "destructive",
        title: "Failed to save document",
        description: "Please try again later.",
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-[500px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between gap-4 pb-4">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg font-medium"
          placeholder="Document Title"
        />
        <Button onClick={() => handleSave()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>
      <Editor 
        content={content} 
        onChange={setContent} 
        documentId={currentDocumentId || undefined}
      />
    </DashboardLayout>
  )
}
