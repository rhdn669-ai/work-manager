import { collection, doc, addDoc, updateDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { trashGeneric } from './trashService';

// 품질 기록 — 서식 10종을 한 컬렉션에서 formKey 로 구분한다.
// 서식마다 테이블을 나누지 않는 이유: 공통 골격(일자·판정·담당)이 70% 이상 겹치고,
// 화면·휴지통·집계 코드를 한 벌만 유지하면 되기 때문.
const recordsRef = collection(db, 'qualityRecords');

export function subscribeRecords(formKey, cb) {
  // 전체 구독 후 JS 필터 — productionService 와 같은 패턴. 서식별 where 쿼리는
  // 규칙·색인 문제가 조용히 삼켜질 수 있어 쓰지 않는다.
  return onSnapshot(
    recordsRef,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.formKey === formKey)
        .sort((a, b) => String(b.recordNo || '').localeCompare(String(a.recordNo || ''), undefined, { numeric: true }));
      cb(rows);
    },
    (err) => console.error('[qualityRecords] 구독 실패:', err),
  );
}

export async function addRecord(formKey, data) {
  const { id: _id, ...rest } = data;
  const ref = await addDoc(recordsRef, { ...rest, formKey, createdAt: serverTimestamp() });
  return { id: ref.id, ...rest };
}

export async function updateRecord(id, patch) {
  await updateDoc(doc(db, 'qualityRecords', id), { ...patch, updatedAt: serverTimestamp() });
}

export async function trashRecord(record, title, deletedByName = '') {
  return trashGeneric('qualityRecords', record.id, { title, summary: record.recordNo || '' }, deletedByName);
}

// 전 서식 기록 구독 — 개요 대시보드 집계용
export function subscribeAllRecords(cb) {
  return onSnapshot(
    recordsRef,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => console.error('[qualityRecords] 전체 구독 실패:', err),
  );
}
