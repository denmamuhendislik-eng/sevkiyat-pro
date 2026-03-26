import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCMtNBTu8RjonEx3VshzRtzQv2kTF52ioE",
  authDomain: "sevkiyat-pro.firebaseapp.com",
  projectId: "sevkiyat-pro",
  storageBucket: "sevkiyat-pro.firebasestorage.app",
  messagingSenderId: "210623172007",
  appId: "1:210623172007:web:1ff00b28b1aeca7e483a82"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
