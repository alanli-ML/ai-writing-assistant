import { type NextRequest, NextResponse } from "next/server"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"
import { initializeApp, getApps, cert } from "firebase-admin/app"

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  })
}

const auth = getAuth()
const db = getFirestore()

export async function POST(req: NextRequest) {
  try {
    // Get the authorization token from the request
    const authHeader = req.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.split("Bearer ")[1]

    // Verify the token
    const decodedToken = await auth.verifyIdToken(token)
    const uid = decodedToken.uid

    // Get the document data from the request
    const { docId, title, content } = await req.json()

    if (!title || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    let documentRef

    if (docId) {
      // Update existing document
      documentRef = db.collection("documents").doc(docId)

      // Verify ownership
      const doc = await documentRef.get()
      if (!doc.exists) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 })
      }

      if (doc.data()?.uid !== uid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
      }

      await documentRef.update({
        title,
        content,
        timestamp: new Date(),
      })
    } else {
      // Create new document
      documentRef = db.collection("documents").doc()
      await documentRef.set({
        uid,
        title,
        content,
        timestamp: new Date(),
      })
    }

    return NextResponse.json({
      success: true,
      docId: documentRef.id,
    })
  } catch (error) {
    console.error("Error in save-document API:", error)
    return NextResponse.json({ error: "Failed to save document" }, { status: 500 })
  }
}
