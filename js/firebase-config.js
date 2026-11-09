// Firebase settings for cloud save (Google sign-in + Firestore).
// Paste the `firebaseConfig` object from Firebase console → Project settings → Your apps → Web app.
// These values are not secret: Firebase web config is meant to be public. Access to your data
// is protected by the Firestore security rules (each signed-in user can only read/write their own document).
// Leave as `null` to turn cloud save off; the app then works with browser storage only.
export const firebaseConfig = null;
