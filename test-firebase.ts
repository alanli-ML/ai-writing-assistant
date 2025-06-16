const { initializeApp } = require("firebase/app");
const { 
  getAuth, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged
} = require("firebase/auth");
const { 
  getFirestore, 
  collection, 
  addDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  deleteDoc,
  doc 
} = require("firebase/firestore");

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Test user credentials
const TEST_EMAIL = `test${Date.now()}@example.com`;
const TEST_PASSWORD = "Test123!@#";

async function runTests() {
  console.log("Starting Firebase tests...\n");

  try {
    // Test 1: Authentication - Email/Password Sign Up
    console.log("Test 1: Email/Password Sign Up");
    const userCredential = await createUserWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
    console.log("✅ Sign up successful");
    console.log("User ID:", userCredential.user.uid);
    console.log("Email:", userCredential.user.email);
    console.log();

    // Test 2: Authentication - Sign Out
    console.log("Test 2: Sign Out");
    await signOut(auth);
    console.log("✅ Sign out successful");
    console.log();

    // Test 3: Authentication - Sign In
    console.log("Test 3: Email/Password Sign In");
    const signInCredential = await signInWithEmailAndPassword(auth, TEST_EMAIL, TEST_PASSWORD);
    console.log("✅ Sign in successful");
    console.log("User ID:", signInCredential.user.uid);
    console.log();

    // Test 4: Firestore - Create Document
    console.log("Test 4: Create Document");
    const docRef = await addDoc(collection(db, "documents"), {
      title: "Test Document",
      content: "This is a test document",
      uid: signInCredential.user.uid,
      timestamp: new Date()
    });
    console.log("✅ Document created successfully");
    console.log("Document ID:", docRef.id);
    console.log();

    // Test 5: Firestore - Read Document
    console.log("Test 5: Read Document");
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      console.log("✅ Document read successfully");
      console.log("Document data:", docSnap.data());
    } else {
      console.log("❌ Document not found");
    }
    console.log();

    // Test 6: Firestore - Query Documents
    console.log("Test 6: Query Documents");
    const q = query(
      collection(db, "documents"),
      where("uid", "==", signInCredential.user.uid)
    );
    const querySnapshot = await getDocs(q);
    console.log("✅ Query successful");
    console.log("Number of documents:", querySnapshot.size);
    querySnapshot.forEach((doc: any) => {
      console.log("Document ID:", doc.id);
      console.log("Document data:", doc.data());
    });
    console.log();

    // Test 7: Firestore - Delete Document
    console.log("Test 7: Delete Document");
    await deleteDoc(docRef);
    console.log("✅ Document deleted successfully");
    console.log();

    // Test 8: Auth State Change
    console.log("Test 8: Auth State Change");
    await new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user: any) => {
        if (user) {
          console.log("✅ Auth state change detected");
          console.log("Current user:", user.email);
        }
        unsubscribe();
        resolve(true);
      });
    });
    console.log();

    // Test 9: Google Sign In (Note: This will open a popup)
    console.log("Test 9: Google Sign In");
    console.log("⚠️ This test requires manual interaction with the Google sign-in popup");
    try {
      await signInWithPopup(auth, googleProvider);
      console.log("✅ Google sign in successful");
    } catch (error) {
      console.log("❌ Google sign in failed (this is expected if popup is blocked)");
    }
    console.log();

    console.log("All tests completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the tests
runTests(); 