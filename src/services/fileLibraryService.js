import {
  collection, doc, addDoc, deleteDoc, onSnapshot, query, where, orderBy, getDocs,
} from 'firebase/firestore';
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'firebase/storage';
import { db, storage, ensureAnonymousAuth } from '../config/firebase';

// 사내 자료실 — 전 직원이 폴더를 만들고 파일을 올리고 받을 수 있는 공용 클라우드 저장소
// Firestore에는 메타데이터(폴더/파일 정보), Firebase Storage에는 실제 파일 바이너리를 저장한다.
// 실시간 구독(onSnapshot)으로 어느 기기에서 변경하든 즉시 다른 기기에 반영된다.

const foldersRef = collection(db, 'libraryFolders');
const filesRef = collection(db, 'libraryFiles');

// ---------- 실시간 구독 ----------

// 폴더 목록 실시간 구독 (생성일 오름차순)
export function subscribeFolders(cb) {
  const q = query(foldersRef, orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[자료실] 폴더 구독 오류:', err);
    cb([]);
  });
}

// 파일 목록 실시간 구독 (최신 업로드 우선)
export function subscribeFiles(cb) {
  const q = query(filesRef, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.error('[자료실] 파일 구독 오류:', err);
    cb([]);
  });
}

// ---------- 폴더 ----------

export async function createFolder(name, user) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('폴더 이름을 입력하세요.');
  await addDoc(foldersRef, {
    name: trimmed,
    createdBy: user?.uid || '',
    createdByName: user?.name || '',
    createdAt: new Date(),
  });
}

// 폴더 삭제 — 폴더 안의 모든 파일(Storage + 메타)도 함께 삭제
export async function deleteFolder(folderId) {
  const q = query(filesRef, where('folderId', '==', folderId));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map(async (d) => {
    const data = d.data();
    if (data.storagePath) {
      try { await deleteObject(ref(storage, data.storagePath)); } catch { /* 이미 없으면 무시 */ }
    }
    await deleteDoc(doc(db, 'libraryFiles', d.id));
  }));
  await deleteDoc(doc(db, 'libraryFolders', folderId));
}

// ---------- 파일 ----------

// 안전한 Storage 경로용 파일명 생성 (한글/공백 보존, 경로 구분자만 치환)
function buildStoragePath(folderId, fileName) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const safeName = (fileName || 'file').replace(/[/\\]/g, '_');
  return `library/${folderId || 'root'}/${stamp}_${safeName}`;
}

// 파일 업로드 — 진행률 콜백(onProgress: 0~100) 지원
// 실제 바이너리는 Storage, 메타데이터는 Firestore에 저장
export async function uploadFile(file, folderId, user, onProgress) {
  await ensureAnonymousAuth(); // Storage 쓰기 권한용 익명 세션 보장
  const storagePath = buildStoragePath(folderId, file.name);
  const task = uploadBytesResumable(ref(storage, storagePath), file, {
    contentType: file.type || 'application/octet-stream',
  });

  // 업로드 진행률 → 완료까지 대기
  await new Promise((resolve, reject) => {
    task.on('state_changed',
      (snap) => {
        if (onProgress && snap.totalBytes) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      reject,
      resolve,
    );
  });

  const downloadURL = await getDownloadURL(task.snapshot.ref);
  await addDoc(filesRef, {
    name: file.name,
    folderId: folderId || null,
    storagePath,
    downloadURL,
    size: file.size || 0,
    contentType: file.type || 'application/octet-stream',
    uploadedBy: user?.uid || '',
    uploadedByName: user?.name || '',
    createdAt: new Date(),
  });
}

export async function deleteFile(fileMeta) {
  if (fileMeta.storagePath) {
    try { await deleteObject(ref(storage, fileMeta.storagePath)); } catch { /* 이미 없으면 무시 */ }
  }
  await deleteDoc(doc(db, 'libraryFiles', fileMeta.id));
}
