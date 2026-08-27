import {
  collection,
  doc,
  addDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage, ensureAnonymousAuth } from '../config/firebase';

// 사내 자료실 — 전 직원이 폴더를 만들고 파일을 올리고 받을 수 있는 공용 클라우드 저장소
// Firestore에는 메타데이터(폴더/파일 정보), Firebase Storage에는 실제 파일 바이너리를 저장한다.
// 실시간 구독(onSnapshot)으로 어느 기기에서 변경하든 즉시 다른 기기에 반영된다.

const foldersRef = collection(db, 'libraryFolders');
const filesRef = collection(db, 'libraryFiles');

// ---------- 실시간 구독 ----------

// 폴더 목록 실시간 구독 (order 우선, 없으면 생성일순) — JS 정렬로 하위호환
export function subscribeFolders(cb) {
  const q = query(foldersRef, orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      // 쿼리가 createdAt 오름차순 → Array.sort는 안정정렬이라 order 동률 시 생성순 유지
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
      cb(list);
    },
    (err) => {
      console.error('[자료실] 폴더 구독 오류:', err);
      cb([]);
    },
  );
}

// 폴더 순서 저장 — [{ id, order }] 배치 갱신
export async function setFolderOrder(updates) {
  if (!updates || updates.length === 0) return;
  const batch = writeBatch(db);
  updates.forEach(({ id, order }) => batch.update(doc(db, 'libraryFolders', id), { order }));
  await batch.commit();
}

// 파일 목록 실시간 구독 (최신 업로드 우선)
export function subscribeFiles(cb) {
  const q = query(filesRef, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('[자료실] 파일 구독 오류:', err);
      cb([]);
    },
  );
}

// ---------- 폴더 ----------

// parentId: 상위 폴더 id (null = 최상위). 중첩 폴더 지원
// opts.protected: 시스템 자동생성 폴더 — 자료실에서 수정·삭제 불가
export async function createFolder(name, user, parentId = null, opts = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('폴더 이름을 입력하세요.');
  const refDoc = await addDoc(foldersRef, {
    name: trimmed,
    parentId: parentId || null,
    createdBy: user?.uid || '',
    createdByName: user?.name || '',
    createdAt: new Date(),
    ...(opts.protected ? { protected: true } : {}),
  });
  return refDoc.id;
}

// 같은 (이름+상위폴더)의 폴더가 있으면 그 id, 없으면 새로 만들어 id 반환
// 기존 폴더는 parentId 필드가 없을 수 있어 JS에서 null로 보정해 매칭(하위 호환)
// opts.protected: 기존 폴더에도 보호 플래그를 보강
export async function ensureFolder(name, user, parentId = null, opts = {}) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('폴더 이름이 비었습니다.');
  const snap = await getDocs(query(foldersRef, where('name', '==', trimmed)));
  const match = snap.docs.find((d) => (d.data().parentId || null) === (parentId || null));
  if (match) {
    if (opts.protected && !match.data().protected) {
      await updateDoc(doc(db, 'libraryFolders', match.id), { protected: true });
    }
    return match.id;
  }
  return createFolder(trimmed, user, parentId, opts);
}

// 폴더 경로(['거래처 정보', '업체명'])를 차례로 보장하고 마지막(말단) 폴더 id 반환
// opts.protected: 경로상 모든 폴더를 자동생성 보호 폴더로 표시(수정·삭제 불가)
export async function ensureFolderPath(parts, user, opts = {}) {
  let parentId = null;
  for (const p of parts || []) {
    if (!p || !String(p).trim()) continue;
    parentId = await ensureFolder(String(p).trim(), user, parentId, opts);
  }
  return parentId;
}

// "거래처 정보 / {업체명}" 폴더에 보관된 그 업체의 파일(사업자등록증·통장사본 등)을 조회.
// 결제 페이지 등에서 업체 사업자등록증을 모달로 보여줄 때 사용.
export async function getSupplierLibraryFiles(supplierName) {
  const name = (supplierName || '').trim();
  if (!name) return [];
  // 1) '거래처 정보' 최상위 폴더
  const rootSnap = await getDocs(query(foldersRef, where('name', '==', '거래처 정보')));
  if (rootSnap.empty) return [];
  const rootIds = rootSnap.docs.map((d) => d.id);
  // 2) 그 아래 '{업체명}' 폴더 (parentId가 거래처 정보 중 하나)
  const supSnap = await getDocs(query(foldersRef, where('name', '==', name)));
  const supFolder = supSnap.docs.find((d) => rootIds.includes(d.data().parentId));
  if (!supFolder) return [];
  // 3) 그 폴더의 파일들 — 사업자등록증을 앞으로 정렬
  const fileSnap = await getDocs(query(filesRef, where('folderId', '==', supFolder.id)));
  const files = fileSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const rank = (n = '') => (/사업자|등록증/.test(n) ? 0 : /통장|계좌/.test(n) ? 1 : 2);
  files.sort((a, b) => rank(a.name) - rank(b.name));
  return files;
}

// 자료실 「명함」 폴더 — 메일 하단에 붙일 담당자 명함.
//
// 전에는 public/cards 에 파일을 넣고 코드에 이름을 박아 두었다. 사람이 들어오거나
// 명함을 바꿀 때마다 개발자가 파일을 넣고 코드를 고쳐 다시 배포해야 했다.
// 자료실에 두면 대표님이 직접 올리고 바꾸실 수 있다 (2026-08-27 대표님).
//
// 파일 이름이 곧 사람 이름이다 — 「손성욱.png」.
// 반환: { 이름: 내려받기주소 }
export const CARD_FOLDER = '명함';

export async function getCardLibrary() {
  const folderSnap = await getDocs(query(foldersRef, where('name', '==', CARD_FOLDER)));
  // 최상위(부모 없음) 「명함」 폴더만 본다 — 프로젝트 아래 같은 이름이 있어도 섞이지 않게
  const folder = folderSnap.docs.find((d) => !d.data().parentId) || folderSnap.docs[0];
  if (!folder) return {};
  const fileSnap = await getDocs(query(filesRef, where('folderId', '==', folder.id)));
  const out = {};
  for (const d of fileSnap.docs) {
    const v = d.data();
    if (!v.downloadURL) continue;
    // 「손성욱.png」 → 「손성욱」
    const who = String(v.name || '')
      .replace(/\.[^.]+$/, '')
      .trim();
    if (who) out[who] = v.downloadURL;
  }
  return out;
}

// 프로젝트(현장) 자료실 표준 하위 폴더 — 프로젝트 생성 시 자동 생성, 각 기능과 연동
export const PROJECT_SUBFOLDERS = ['발주이력', '자료', '견적', 'BOM'];
// 모든 프로젝트 폴더를 담는 최상위 묶음 폴더
export const PROJECT_ROOT_FOLDER = '프로젝트';

// "프로젝트" 묶음폴더 > 프로젝트명 > [발주이력/자료/견적/BOM] 구조를 보장하고
// { rootId, sub: { 발주이력, 자료, 견적, BOM } } 반환 (idempotent)
// 과거에 자료실 최상위에 생성됐던 동명 프로젝트 폴더는 "프로젝트" 아래로 자동 이동(마이그레이션)
export async function ensureProjectFolders(siteName, user) {
  const name = (siteName || '').trim();
  if (!name) return null;
  const rootParent = await ensureFolder(PROJECT_ROOT_FOLDER, user, null, { protected: true });
  // 최상위(parentId=null)에 흩어져 있던 동명 프로젝트 폴더가 있으면 "프로젝트" 아래로 이동
  const existing = await getDocs(query(foldersRef, where('name', '==', name)));
  const topLevel = existing.docs.find((d) => (d.data().parentId || null) === null);
  if (topLevel && topLevel.id !== rootParent) {
    await updateDoc(doc(db, 'libraryFolders', topLevel.id), { parentId: rootParent });
  }
  const rootId = await ensureFolder(name, user, rootParent, { protected: true });
  const sub = {};
  for (const f of PROJECT_SUBFOLDERS) {
    sub[f] = await ensureFolder(f, user, rootId, { protected: true });
  }
  return { rootId, sub };
}

// 기존 "발주이력" 폴더 직속 파일들을 발주월(YYYY-MM) 하위 폴더로 일괄 이동(정리)
// 월 판별: 파일명 IOPN{YYYYMMDD} 우선, 없으면 업로드일(createdAt) 기준. (idempotent)
export async function organizeOrderHistory(user) {
  const histFolders = (await getDocs(query(foldersRef, where('name', '==', '발주이력')))).docs;
  let moved = 0;
  for (const hf of histFolders) {
    const histId = hf.id;
    const fileSnap = await getDocs(query(filesRef, where('folderId', '==', histId)));
    for (const fd of fileSnap.docs) {
      const f = fd.data();
      const m = (f.name || '').match(/IOPN(\d{4})(\d{2})\d{2}/);
      let ym;
      if (m) {
        ym = `${m[1]}-${m[2]}`;
      } else {
        const d = f.createdAt?.toDate ? f.createdAt.toDate() : f.createdAt ? new Date(f.createdAt) : new Date();
        ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      const monthId = await ensureFolder(ym, user, histId, { protected: true });
      if (monthId && monthId !== histId) {
        await updateDoc(doc(db, 'libraryFiles', fd.id), { folderId: monthId });
        moved++;
      }
    }
  }
  return moved;
}

// 폴더 이름 변경
export async function renameFolder(folderId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('폴더 이름을 입력하세요.');
  await updateDoc(doc(db, 'libraryFolders', folderId), { name: trimmed });
}

// 파일 표시명(Firestore name)만 변경 — Storage 실제 객체는 건드리지 않음
export async function renameFile(fileId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) throw new Error('파일 이름을 입력하세요.');
  await updateDoc(doc(db, 'libraryFiles', fileId), { name: trimmed });
}

// 폴더 문서만 삭제 — 파일 휴지통 이동은 호출자(FileLibraryPage)가 처리
export async function deleteFolder(folderId) {
  await deleteDoc(doc(db, 'libraryFolders', folderId));
}

// ---------- 파일 ----------

// 안전한 Storage 경로용 파일명 생성 (한글/공백 보존, 경로 구분자만 치환)
function buildStoragePath(folderId, fileName) {
  const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const safeName = (fileName || 'file').replace(/[/\\]/g, '_');
  return `library/${folderId || 'root'}/${stamp}_${safeName}`;
}

// 파일 업로드 — 진행률 콜백(onProgress: 0~100), 표시 파일명(displayName) 지원
// 실제 바이너리는 Storage, 메타데이터는 Firestore에 저장
export async function uploadFile(file, folderId, user, onProgress, displayName) {
  // 익명 인증 시도 — 비활성화돼 있어도(Storage 규칙 공개면) 업로드는 계속 진행
  try {
    await ensureAnonymousAuth();
  } catch (e) {
    console.warn('[자료실] 익명 인증 생략:', e?.message || e);
  }
  const fileName = (displayName && displayName.trim()) || file.name;
  const storagePath = buildStoragePath(folderId, fileName);
  const task = uploadBytesResumable(ref(storage, storagePath), file, {
    contentType: file.type || 'application/octet-stream',
  });

  // 업로드 진행률 → 완료까지 대기
  await new Promise((resolve, reject) => {
    task.on(
      'state_changed',
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
    name: fileName,
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

// 파일을 다른 폴더로 이동 (드래그앤드롭) — folderId(null=전체) 갱신
export async function moveFile(fileId, folderId) {
  await updateDoc(doc(db, 'libraryFiles', fileId), { folderId: folderId || null });
}

// 폴더를 다른 폴더 안으로 이동(중첩) 또는 최상위로 — parentId(null=최상위) 갱신
export async function moveFolder(folderId, newParentId) {
  await updateDoc(doc(db, 'libraryFolders', folderId), { parentId: newParentId || null });
}

// 기존 파일의 "내용(바이너리)"만 새 Blob으로 교체 — 파일 doc·이름·폴더·위치는 그대로 유지.
// 발주서 저장본 일괄 재생성처럼 "같은 파일을 새 양식으로 갱신"할 때 사용(휴지통·중복 없이 in-place).
export async function replaceLibraryFile(fileMeta, blob, user) {
  try {
    await ensureAnonymousAuth();
  } catch (e) {
    console.warn('[자료실] 익명 인증 생략:', e?.message || e);
  }
  const folderId = fileMeta.folderId || null;
  const fileName = fileMeta.name || 'document.pdf';
  const newPath = buildStoragePath(folderId, fileName);
  const task = uploadBytesResumable(ref(storage, newPath), blob, { contentType: 'application/pdf' });
  await new Promise((resolve, reject) => {
    task.on('state_changed', null, reject, resolve);
  });
  const downloadURL = await getDownloadURL(task.snapshot.ref);
  await updateDoc(doc(db, 'libraryFiles', fileMeta.id), {
    storagePath: newPath,
    downloadURL,
    size: blob.size || 0,
    contentType: 'application/pdf',
    updatedAt: new Date(),
    updatedByName: user?.name || '',
  });
  // 이전 Storage 객체 정리(실패해도 무시)
  if (fileMeta.storagePath && fileMeta.storagePath !== newPath) {
    try {
      await deleteObject(ref(storage, fileMeta.storagePath));
    } catch {
      /* 이미 없으면 무시 */
    }
  }
}

export async function deleteFile(fileMeta) {
  if (fileMeta.storagePath) {
    try {
      await deleteObject(ref(storage, fileMeta.storagePath));
    } catch {
      /* 이미 없으면 무시 */
    }
  }
  await deleteDoc(doc(db, 'libraryFiles', fileMeta.id));
}
