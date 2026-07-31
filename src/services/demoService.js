import { collection, doc, getDocs, addDoc, deleteDoc, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { DEMO_FLAG, demoPanels, demoAssets, demoRecords } from '../domain/demoSeed';
import { computeCalcFields } from '../domain/qualityFormFields';
import { recompute } from '../domain/production';

// 구조 확인용 가상 데이터 넣기·지우기.
//
// 삭제 정책 — 데모 문서는 휴지통을 거치지 않고 바로 완전 삭제한다.
// 앱의 일반 규칙은 '영구삭제 금지·휴지통 경유'지만, 데모는 업무 기록이 아니라
// 화면 확인용 더미다. 휴지통에 쌓이면 진짜 삭제 기록을 가려 오히려 위험하다.
// 모든 데모 문서에는 demo: true 가 박혀 있어 이 함수 밖에서는 지워지지 않는다.

const COLLECTIONS = ['productionPanels', 'qualityAssets', 'qualityRecords'];

export async function seedDemo() {
  const counts = { 판넬: 0, 자산: 0, 기록: 0 };

  for (const p of demoPanels()) {
    await addDoc(collection(db, 'productionPanels'), { ...recompute(p), createdAt: serverTimestamp() });
    counts.판넬 += 1;
  }
  for (const a of demoAssets()) {
    await addDoc(collection(db, 'qualityAssets'), { ...a, createdAt: serverTimestamp() });
    counts.자산 += 1;
  }
  for (const r of demoRecords()) {
    const { formKey, ...rest } = computeCalcFields(r.formKey, r);
    await addDoc(collection(db, 'qualityRecords'), { ...rest, formKey, createdAt: serverTimestamp() });
    counts.기록 += 1;
  }
  return counts;
}

// demo: true 인 문서만 골라 완전 삭제. 진짜 데이터는 절대 건드리지 않는다.
export async function clearDemo() {
  let removed = 0;
  for (const name of COLLECTIONS) {
    const snap = await getDocs(query(collection(db, name), where(DEMO_FLAG, '==', true)));
    for (const d of snap.docs) {
      await deleteDoc(doc(db, name, d.id));
      removed += 1;
    }
  }
  return removed;
}

// 지금 데모 데이터가 들어 있는지 (버튼 문구를 바꾸는 데 쓴다)
export async function countDemo() {
  let n = 0;
  for (const name of COLLECTIONS) {
    const snap = await getDocs(query(collection(db, name), where(DEMO_FLAG, '==', true)));
    n += snap.size;
  }
  return n;
}
