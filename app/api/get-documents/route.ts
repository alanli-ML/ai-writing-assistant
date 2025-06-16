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

export async function GET(req: NextRequest) {
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

    // Get all documents for the user
    const snapshot = await db.collection("documents").where("uid", "==", uid).orderBy("timestamp", "desc").get()

    const documents = snapshot.docs.map((doc) => {
      const data = doc.data()
      return {
        id: doc.id,
        title: data.title,
        timestamp: data.timestamp.toDate(),
        // Don't include full content to reduce payload size
        excerpt: data.content.substring(0, 150) + (data.content.length > 150 ? "..." : ""),
      }
    })

    return NextResponse.json({ documents })
  } catch (error) {
    console.error("Error in get-documents API:", error)
    return NextResponse.json({ error: "Failed to fetch documents" }, { status: 500 })
  }
}
