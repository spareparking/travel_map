// Firebase settings for cloud save (Google sign-in + Firestore).
// From Firebase console → Project settings → Your apps → Web app.
// These values are not secret: Firebase web config is meant to be public. Access to your data
// is protected by the Firestore security rules (each signed-in user can only read/write their own document).
// Set to `null` to turn cloud save off; the app then works with browser storage only.
export const firebaseConfig = {
  apiKey: 'AIzaSyDGsysFUk4y3b5KKwfMchPoc-jbYeCzcjw',
  authDomain: 'travel-map-159b1.firebaseapp.com',
  projectId: 'travel-map-159b1',
  storageBucket: 'travel-map-159b1.firebasestorage.app',
  messagingSenderId: '642944522806',
  appId: '1:642944522806:web:ebb2e89ec34fe7bf599697',
};
