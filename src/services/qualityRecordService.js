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

// 채번 — PREFIX-연도-4자리. 관리자는 화면에서 수정 가능.
export function nextRecordNo(rows, prefix, year = new Date().getFullYear()) {
  const head = `${prefix}-${year}-`;
  const used = rows
    .map((r) => String(r.recordNo || ''))
    .filter((s) => s.startsWith(head))
    .map((s) => Number(s.slice(head.length)))
    .filter((n) => Number.isFinite(n));
  const next = used.length ? Math.max(...used) + 1 : 1;
  return `${head}${String(next).padStart(4, '0')}`;
}
