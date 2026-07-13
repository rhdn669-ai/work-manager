import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyDmjuf6Lyu_bRYbFRfTAYFxpm_QW7vbZd4',
  authDomain: 'work-9929e.firebaseapp.com',
  projectId: 'work-9929e',
  storageBucket: 'work-9929e.firebasestorage.app',
  messagingSenderId: '25022130930',
  appId: '1:25022130930:web:ae44532d4379cb901f7e6b',
};

const app = initializeApp(firebaseConfig);

// App Check(reCAPTCHA v3) — 사이트 키가 설정된 경우에만 활성화. 사용자 화면 변화 없음.
// Firebase 콘솔에서 모니터링 모드로 시작 → 이상 없으면 강제(enforce) 전환.
const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY;
if (appCheckKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn('App Check 초기화 실패(앱 동작에는 영향 없음):', e);
  }
}

// 오프라인 지속 캐시 — 재방문·새로고침 시 서버 재조회 대신 로컬 캐시 사용 (읽기 비용·속도 개선).
// 여러 탭 동시 사용도 지원.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const storage = getStorage(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, 'asia-northeast3');
// 메일 발송 — 서버(MAIL_TOKEN 시크릿)와 대조하는 공유 토큰을 자동 주입해 외부 무단 호출 차단
const _sendEmail = httpsCallable(functions, 'sendPurchaseOrderEmail');
export const callSendEmail = (data) => _sendEmail({ ...data, token: import.meta.env.VITE_MAIL_TOKEN || '' });

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
