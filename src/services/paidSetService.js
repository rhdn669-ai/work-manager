import { collection, doc, onSnapshot, query, where, setDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { updatePanel } from './productionService';
import { setReceivedMany } from './panelMaterialsService';
import { isFreeIssue } from './bomService';
import { CHECKABLE_BOXES, bomRowsForBox } from '../domain/panelBom';
import { boxMat, boxMatDate, deriveBoxStatus } from '../domain/production';

// 도급 세트 (2026-09-03 대표님) — 우리가 사서 넣는 도급 자재를 세트로 세고 호기에 배정한다.
//
//   설정   settings/paidSets  { [회사]: { startProject } }
//   입고   발주서(purchases) 줄의 receivedQty — 프로젝트(siteId)가 그 BOM 프로젝트인 발주서만
//   배정   판넬 문서 paidSet { seq, at, by } + 그 호기 BOX 별 도급 줄 들어온 개수 = BOM 수량
//          + 자재 도급 칸 켜짐 (자재 체크 페이지 ④ 연동과 같은 결과)

const settingsRef = doc(db, 'settings', 'paidSets');
const purchasesRef = collection(db, 'purchases');

export function subscribePaidSetSettings(cb) {
  return onSnapshot(settingsRef, (snap) => cb(snap.exists() ? snap.data() : {}));
}

export async function savePaidSetSettings(company, patch) {
  await setDoc(settingsRef, { [company]: patch, updatedAt: serverTimestamp() }, { merge: true });
}

/** 그 프로젝트 발주서들의 품목별 입고 합 — cb({ [itemId]: qty }, { purchases: N, lines: N, noItem: N }) */
export function subscribeReceivedBySite(siteId, cb) {
  if (!siteId) return () => {};
  const q = query(purchasesRef, where('siteId', '==', siteId));
  return onSnapshot(
    q,
    (snap) => {
      const out = {};
      let lines = 0;
      let noItem = 0;
      snap.docs.forEach((d) => {
        const v = d.data();
        for (const ln of v.items || []) {
          const got = Number(ln.receivedQty) || 0;
          if (got <= 0) continue;
          lines += 1;
          if (!ln.itemId) {
            noItem += 1;
            continue;
          }
          out[ln.itemId] = (out[ln.itemId] || 0) + got;
        }
      });
      cb(out, { purchases: snap.size, lines, noItem });
    },
    (err) => {
      console.error('[도급 세트] 발주 입고 구독 오류:', err);
      cb({}, { purchases: 0, lines: 0, noItem: 0 });
    },
  );
}

// 호기의 BOX 별 도급 줄 — { box: rows[] } (줄 없는 BOX 는 뺀다)
function paidRowsByBox(variantRows) {
  const out = {};
  for (const box of CHECKABLE_BOXES) {
    const rows = bomRowsForBox(variantRows, box).filter((r) => !isFreeIssue(r));
    if (rows.length) out[box] = rows;
  }
  return out;
}

// 자재 도급 칸을 켜거나 끄는 patch — 박스입고·박스입고일자·부품상태 (표의 toggleBoxMat 와 같은 모양)
function matPatch(panel, boxes, on) {
  const today = new Date().toISOString().slice(0, 10);
  const 박스입고 = { ...(panel.박스입고 || {}) };
  const 박스입고일자 = { ...(panel.박스입고일자 || {}) };
  const 부품상태 = { ...(panel.부품상태 || {}) };
  for (const box of boxes) {
    const mat = { ...boxMat(panel, box), 자재_도급: on };
    박스입고[box] = mat;
    박스입고일자[box] = { ...boxMatDate(panel, box), 자재_도급: on ? today : '' };
    부품상태[box] = deriveBoxStatus(panel, box, panel.검수, mat);
  }
  return { 박스입고, 박스입고일자, 부품상태 };
}

/** 세트 하나를 이 호기에 — 도급 줄 수량 채움 + 자재 도급 칸 켬 + 배정 기록 */
export async function assignPaidSet(panel, variantRows, { by = '', seq = 0 } = {}) {
  const byBox = paidRowsByBox(variantRows);
  const boxes = Object.keys(byBox);
  await Promise.all(
    boxes.map((box) =>
      setReceivedMany(
        panel.id,
        box,
        byBox[box].map((r) => ({ id: r.id, qty: Number(r.qty) || 0 })),
        by,
      ),
    ),
  );
  await updatePanel(panel.id, {
    ...matPatch(panel, boxes, true),
    paidSet: { seq, at: new Date().toISOString().slice(0, 10), by },
  });
}

/** 배정 취소 — 도급 줄 수량 0 + 자재 도급 칸 끔 + 배정 기록 지움 */
export async function unassignPaidSet(panel, variantRows, { by = '' } = {}) {
  const byBox = paidRowsByBox(variantRows);
  const boxes = Object.keys(byBox);
  await Promise.all(
    boxes.map((box) =>
      setReceivedMany(
        panel.id,
        box,
        byBox[box].map((r) => ({ id: r.id, qty: 0 })),
        by,
      ),
    ),
  );
  await updatePanel(panel.id, { ...matPatch(panel, boxes, false), paidSet: deleteField() });
}
