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
import { NCR_FORM_KEY, SHIPMENT_FORM_KEY, panelToNcrFacts, panelToShipmentFacts } from '../domain/productionQuality';

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

// 대장(formKey)별로 그 판넬의 자동 레코드를 찾는다.
// 한 판넬이 부적합 실적·출하검사 실적 두 곳에 1건씩 갖는다.
async function findByPanel(panelId, formKey) {
  // 자동 레코드는 sourcePanelId 로 직접 찾는다(전체 구독과 달리 1회성 조회라 where 가 맞다)
  const snap = await getDocs(query(recordsRef, where('sourcePanelId', '==', panelId)));
  const hit = snap.docs.find((d) => !d.data().deleted && (!formKey || d.data().formKey === formKey));
  return hit ? { id: hit.id, ...hit.data() } : null;
}

// 대장 한 곳을 판넬 사실에 맞춘다 (upsert). 반환: 'created' | 'updated' | 'removed' | 'noop'
async function syncOne(panel, formKey, facts, title) {
  const existing = await findByPanel(panel.id, formKey);
  if (!facts) {
    // 불량이 모두 지워진 판넬 — 자동 레코드도 휴지통으로 (영구삭제 금지 규칙)
    if (!existing) return 'noop';
    await trashGeneric(
      'qualityRecords',
      existing.id,
      { title: existing.itemName || title, summary: '생산현황 불량 해제로 자동 정리' },
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
  await addRecord(formKey, {
    ...facts,
    recordNo: '', // 사내 문서번호 규칙대로 품질팀이 채운다 (임의 채번하지 않음)
    inspectionDate: todayStr(), // 최초 생성일만 기록 — 이후 동기화는 건드리지 않는다
    sourcePanelId: panel.id,
    sourceType: 'production',
  });
  return 'created';
}

// 반환: 'created' | 'updated' | 'removed' | 'noop'. 실패는 던진다 — 조용히 삼키면
// "왜 품질보증에 안 뜨지" 를 알 방법이 없다. 호출부에서 사용자에게 알린다.
//
// 판넬 불량은 출하 전 최종 검사에서 잡히므로 발생공정이 「출하검사」다.
// 그래서 부적합 실적과 출하검사 실적 두 대장에 함께 올린다 (2026-08-10 대표님).
export async function syncPanelNcr(panel) {
  if (!panel?.id) return 'noop';
  const r1 = await syncOne(panel, NCR_FORM_KEY, panelToNcrFacts(panel), '부적합 실적');
  const r2 = await syncOne(panel, SHIPMENT_FORM_KEY, panelToShipmentFacts(panel), '출하검사 실적');
  // 한 곳이라도 바뀌었으면 바뀐 것으로 알린다
  for (const r of ['created', 'updated', 'removed']) if (r1 === r || r2 === r) return r;
  return 'noop';
}

// 판넬이 통째로 사라질 때 딸린 자동 기록도 함께 정리한다.
// syncPanelNcr 은 '불량이 지워진 판넬'만 다루므로, 판넬 자체가 없어지는 경우는 여기서 맡는다.
export async function removePanelNcr(panelId, deletedByName = '자동') {
  if (!panelId) return 'noop';
  let done = 'noop';
  // 부적합 실적·출하검사 실적 두 곳 모두 내린다
  for (const key of [NCR_FORM_KEY, SHIPMENT_FORM_KEY]) {
    const existing = await findByPanel(panelId, key);
    if (!existing) continue;
    await trashGeneric(
      'qualityRecords',
      existing.id,
      { title: existing.itemName || '자동 기록', summary: '생산현황 판넬 삭제로 자동 정리' },
      deletedByName,
    );
    done = 'removed';
  }
  return done;
}

// 연동 붙이기 전부터 쌓여 있던 불량을 한 번에 올린다.
// 생산현황·품질보증 어느 쪽으로 들어오든 최신 상태가 되도록 두 화면 모두 진입 시 호출한다.
// 값이 같으면 쓰지 않으므로 두 번째부터는 읽기만 하고 끝난다.
export async function backfillNcrFromPanels() {
  const snap = await getDocs(collection(db, 'productionPanels'));
  const results = await Promise.all(
    snap.docs.map((d) => syncPanelNcr({ id: d.id, ...d.data() }).catch(() => 'failed')),
  );

  // 판넬이 이미 사라진 자동 기록 정리 — 연동을 붙이기 전에 지운 판넬의 불량이
  // 대장·통계·최근 등록에 계속 남아 있던 것을 여기서 걷어낸다.
  try {
    const live = new Set(snap.docs.map((d) => d.id));
    const auto = await getDocs(query(recordsRef, where('sourceType', '==', 'production')));
    const orphans = auto.docs.filter((d) => {
      const r = d.data();
      return !r.deleted && !live.has(r.sourcePanelId);
    });
    for (const d of orphans) {
      await trashGeneric(
        'qualityRecords',
        d.id,
        { title: d.data().itemName || '부적합 실적', summary: '생산현황에 없는 판넬 — 자동 정리' },
        '자동',
      );
    }
  } catch (err) {
    console.error('[품질] 사라진 판넬 기록 정리 실패:', err);
  }

  return results.filter((r) => r === 'created' || r === 'updated').length;
}
