// 자료를 어디서 읽고 쓸지 한 곳에서 고른다.
//
//   VITE_BACKEND=server  → 사내 서버(시놀로지 NAS)
//   그 밖(기본)          → 지금까지 쓰던 구글 Firebase
//
// 서비스 파일들은 이 파일에서 가져다 쓰기만 하면 되므로, 바꿔 끼워도 코드가 그대로다.
// 문제가 생기면 값을 되돌리고 다시 올리면 즉시 원래대로 돌아간다. (2026-09-07 온프레미스 이전)
import * as fb from 'firebase/firestore';
import { db as firebaseDb } from './firebase';
import * as server from './serverData';

export const BACKEND = import.meta.env.VITE_BACKEND === 'server' ? 'server' : 'firebase';
export const isServer = BACKEND === 'server';

const impl = isServer ? server : fb;

export const db = isServer ? server.db : firebaseDb;

export const collection = impl.collection;
export const doc = impl.doc;
export const query = impl.query;
export const where = impl.where;
export const orderBy = impl.orderBy;
export const limit = impl.limit;
export const documentId = impl.documentId;

export const getDoc = impl.getDoc;
export const getDocs = impl.getDocs;
export const getDocFromServer = impl.getDocFromServer;
export const getCountFromServer = impl.getCountFromServer;
export const onSnapshot = impl.onSnapshot;

export const addDoc = impl.addDoc;
export const setDoc = impl.setDoc;
export const updateDoc = impl.updateDoc;
export const writeBatch = impl.writeBatch;

// 지우기 — 앱의 삭제는 늘 휴지통을 먼저 거치고, 여기까지 오는 건 관리자의 영구 삭제뿐이다.
const removeOne = impl.deleteDoc;
export { removeOne as deleteDoc };

export const serverTimestamp = impl.serverTimestamp;
export const deleteField = impl.deleteField;
export const arrayUnion = impl.arrayUnion;
export const arrayRemove = impl.arrayRemove;
export const increment = impl.increment;
export const Timestamp = impl.Timestamp;

// 아래 둘은 Firebase 의 로컬 캐시를 비우는 기능이라 서버 모드에는 없다 — 부르면 조용히 넘어간다.
export const terminate = isServer ? async () => {} : fb.terminate;
export const clearIndexedDbPersistence = isServer ? async () => {} : fb.clearIndexedDbPersistence;
