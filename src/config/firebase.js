import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

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
export const storage = getStorage(app);
export const auth = getAuth(app);

// Firebase Storage 업로드 권한을 위한 익명 인증 보장
// 앱 자체 인증(accessCode) 외에 Firebase 세션이 필요한 기능(Storage)용
let _anonPromise = null;
export function ensureAnonymousAuth() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (_anonPromise) return _anonPromise;
  _anonPromise = new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        unsub();
        resolve(user);
      }
    });
    signInAnonymously(auth).catch((err) => {
      _anonPromise = null;
      reject(err);
    });
  });
  return _anonPromise;
}

// 익명 인증은 파일 업로드 등 Storage 사용 시에만 명시적으로 호출됩니다.

export default app;
