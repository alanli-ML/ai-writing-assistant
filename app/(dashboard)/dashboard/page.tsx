"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { collection, getDocs, query, where, deleteDoc, doc } from "firebase/firestore"
import { PlusCircle, Loader2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/use-toast"
import { DashboardLayout } from "@/components/dashboard-layout"
import { useAuth } from "@/components/auth-provider"
import { db } from "@/components/auth-provider"

type Document = {
  id: string
  title: string
  timestamp: any
  content: string
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDocuments() {
      if (!user) return

      try {
        const q = query(collection(db, "documents"), where("uid", "==", user.uid))
        const querySnapshot = await getDocs(q)

        const docs: Document[] = []
        querySnapshot.forEach((doc) => {
          const data = doc.data()
          docs.push({
            id: doc.id,
            title: data.title || "Untitled Document",
            timestamp: data.timestamp?.toDate() || new Date(),
            content: data.content || "",
          })
        })

        // Sort by most recent first
        docs.sort((a, b) => b.timestamp - a.timestamp)
        setDocuments(docs)
      } catch (error) {
        console.error("Error fetching documents:", error)
        toast({
          variant: "destructive",
          title: "Failed to load documents",
          description: "Please try again later.",
        })
      } finally {
        setLoading(false)
      }
    }

    fetchDocuments()
  }, [user, toast])

  const handleCreateDocument = () => {
    router.push("/editor/new")
  }

  const handleDeleteDocument = async (id: string) => {
    setDeleteLoading(id)
    try {
      await deleteDoc(doc(db, "documents", id))
      setDocuments(documents.filter((doc) => doc.id !== id))
      toast({
        title: "Document deleted",
        description: "Your document has been deleted successfully.",
      })
    } catch (error) {
      console.error("Error deleting document:", error)
      toast({
        variant: "destructive",
        title: "Failed to delete document",
        description: "Please try again later.",
      })
    } finally {
      setDeleteLoading(null)
    }
  }

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date)
  }

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Your Documents</h1>
        <Button onClick={handleCreateDocument}>
          <PlusCircle className="mr-2 h-4 w-4" />
          New Document
        </Button>
      </div>

      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : documents.length === 0 ? (
        <div className="mt-16 flex flex-col items-center justify-center space-y-4 text-center">
          <div className="rounded-full bg-primary/10 p-4">
            <PlusCircle className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold">No documents yet</h2>
          <p className="max-w-md text-muted-foreground">
            Create your first document to start getting AI-powered writing suggestions.
          </p>
          <Button onClick={handleCreateDocument}>Create Document</Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <Card key={doc.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="truncate">{doc.title}</CardTitle>
                <CardDescription>{formatDate(doc.timestamp)}</CardDescription>
              </CardHeader>
              <CardContent className="h-24 overflow-hidden text-sm text-muted-foreground">
                <p className="line-clamp-4">{doc.content}</p>
              </CardContent>
              <CardFooter className="flex justify-between border-t bg-muted/50 px-6 py-3">
                <Link href={`/editor/${doc.id}`}>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </Link>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive">
                      {deleteLoading === doc.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Document</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete this document? This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDeleteDocument(doc.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
