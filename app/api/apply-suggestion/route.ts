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

    // Get the suggestion data from the request
    const { docId, suggestionId, type, original, suggested } = await req.json()

    if (!docId || !suggestionId || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Log the applied suggestion for personalization tracking
    await db.collection("appliedSuggestions").add({
      uid,
      docId,
      suggestionId,
      type,
      original,
      suggested,
      timestamp: new Date(),
    })

    return NextResponse.json({
      success: true,
      message: "Suggestion application logged successfully",
    })
  } catch (error) {
    console.error("Error in apply-suggestion API:", error)
    return NextResponse.json({ error: "Failed to log suggestion application" }, { status: 500 })
  }
}
