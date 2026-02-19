import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCijQT0UnSE11EZJfPYff0Vjjm08lkO9ow",
  authDomain: "crm-two.firebaseapp.com",
  projectId: "crm-two",
  storageBucket: "crm-two.firebasestorage.app",
  messagingSenderId: "790824940881",
  appId: "1:790824940881:web:6f42cce236594d99f30f70"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const providerGoogle = new GoogleAuthProvider();
export const db = getFirestore(app);

