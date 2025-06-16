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

    // Get the document ID from the request
    const { docId } = await req.json()

    if (!docId) {
      return NextResponse.json({ error: "Missing document ID" }, { status: 400 })
    }

    // Get the document reference
    const documentRef = db.collection("documents").doc(docId)

    // Verify the document exists and belongs to the user
    const doc = await documentRef.get()
    if (!doc.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 })
    }

    if (doc.data()?.uid !== uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    // Delete the document
    await documentRef.delete()

    return NextResponse.json({
      success: true,
      message: "Document deleted successfully",
    })
  } catch (error) {
    console.error("Error in delete-document API:", error)
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 })
  }
}
