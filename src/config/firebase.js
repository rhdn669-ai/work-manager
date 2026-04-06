import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDmjuf6Lyu_bRYbFRfTAYFxpm_QW7vbZd4",
  authDomain: "work-9929e.firebaseapp.com",
  projectId: "work-9929e",
  storageBucket: "work-9929e.firebasestorage.app",
  messagingSenderId: "25022130930",
  appId: "1:25022130930:web:ae44532d4379cb901f7e6b",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export default app;
