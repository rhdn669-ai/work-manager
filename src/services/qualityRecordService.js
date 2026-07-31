import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { trashGeneric } from './trashService';
import { NCR_FORM_KEY, panelToNcrFacts } from '../domain/productionQuality';

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

/* ── 생산현황 ↔ 부적합 실적 자동 연동 ──────────────────────────────
   판넬이 저장될 때마다 그 판넬의 부적합 레코드를 1건으로 맞춘다(upsert).
   sourcePanelId 로만 짝을 찾으므로 중복 생성되지 않는다.
   품질팀이 채우는 칸(문서번호·조치·대책·검증이력·판정·종결일)은 절대 덮어쓰지 않는다. */
const todayStr = () => new Date().toISOString().slice(0, 10);

async function findByPanel(panelId) {
  // 자동 레코드는 sourcePanelId 로 직접 찾는다(전체 구독과 달리 1회성 조회라 where 가 맞다)
  const snap = await getDocs(query(recordsRef, where('sourcePanelId', '==', panelId)));
  const hit = snap.docs.find((d) => !d.data().deleted);
  return hit ? { id: hit.id, ...hit.data() } : null;
}

// 반환: 'created' | 'updated' | 'removed' | 'noop'. 실패는 던진다 — 조용히 삼키면
// "왜 품질보증에 안 뜨지" 를 알 방법이 없다. 호출부에서 사용자에게 알린다.
export async function syncPanelNcr(panel) {
  if (!panel?.id) return 'noop';
  const facts = panelToNcrFacts(panel);
  const existing = await findByPanel(panel.id);

  if (!facts) {
    // 불량이 모두 지워진 판넬 — 자동 레코드도 휴지통으로 (영구삭제 금지 규칙)
    if (!existing) return 'noop';
    await trashGeneric(
      'qualityRecords',
      existing.id,
      { title: existing.itemName || '부적합 실적', summary: '생산현황 불량 해제로 자동 정리' },
      '자동',
    );
    return 'removed';
  }
  // 값이 그대로면 쓰지 않는다 — 소급 동기화가 판넬 수만큼 쓰기를 만들지 않게
  if (existing) {
    const same = Object.keys(facts).every((k) => (existing[k] ?? '') === (facts[k] ?? ''));
    if (same) return 'noop';
    await updateRecord(existing.id, facts);
    return 'updated';
  }
  await addRecord(NCR_FORM_KEY, {
    ...facts,
    recordNo: '', // 사내 문서번호 규칙대로 품질팀이 채운다 (임의 채번하지 않음)
    inspectionDate: todayStr(), // 최초 생성일만 기록 — 이후 동기화는 건드리지 않는다
    sourcePanelId: panel.id,
    sourceType: 'production',
  });
  return 'created';
}

// 연동 붙이기 전부터 쌓여 있던 불량을 한 번에 올린다.
// 생산현황·품질보증 어느 쪽으로 들어오든 최신 상태가 되도록 두 화면 모두 진입 시 호출한다.
// 값이 같으면 쓰지 않으므로 두 번째부터는 읽기만 하고 끝난다.
export async function backfillNcrFromPanels() {
  const snap = await getDocs(collection(db, 'productionPanels'));
  const results = await Promise.all(
    snap.docs.map((d) => syncPanelNcr({ id: d.id, ...d.data() }).catch(() => 'failed')),
  );
  return results.filter((r) => r === 'created' || r === 'updated').length;
}
