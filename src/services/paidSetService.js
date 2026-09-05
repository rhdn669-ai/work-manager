import { collection, doc, onSnapshot, query, where, setDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { updatePanel } from './productionService';
import { setReceivedMany, getPanelMaterials } from './panelMaterialsService';
import { isFreeIssue } from './bomService';
import { CHECKABLE_BOXES, bomRowsForBox } from '../domain/panelBom';
import { boxMat, boxMatDate, deriveBoxStatus } from '../domain/production';
import { fillPlan } from '../domain/paidSets';
import { setLotsOf } from '../utils/setLots';
import { consumeItemStock } from './purchaseService';

// 도급 세트 (2026-09-03 대표님) — 우리가 사서 넣는 도급 자재를 세트로 세고 호기에 배정한다.
//
//   설정   settings/paidSets  { [회사]: { startProject, siteId, siteName } }
//   입고   발주서(purchases) 줄의 receivedQty — 프로젝트(siteId)가 설정한 발주 현장인 발주서만.
//          BOM 프로젝트(bomProjects)와 발주서의 현장(sites)은 다른 목록이라 id 가 다르다 —
//          그래서 어느 현장 발주서를 셀지 회사마다 한 번 고른다 (2026-09-03 대표님 「연결 고리」)
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

/** 세트 셈에서 품목을 빼거나 되돌린다 — settings.[회사].excluded.[itemId] = true */
export async function setPaidSetExcluded(company, itemId, excluded) {
  await setDoc(
    settingsRef,
    { [company]: { excluded: { [itemId]: excluded ? true : deleteField() } }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** 그 현장 발주서들의 품목별 입고 합 —
 *  cb({ [itemId]: qty }, { purchases, lines, noItem, setCount, lotsByName })
 *  setCount = 입고된 발주서에 적힌 세트 수 합(전 타입), lotsByName = 세트 이름(타입)별 합 — 화면은 이걸로 묶음마다 센다
 *  (2026-09-05 대표님 안 B 1단계: 타입을 무시하고 합산하던 버그 해소) */
export function subscribeReceivedBySite(siteId, cb) {
  if (!siteId) return () => {};
  const q = query(purchasesRef, where('siteId', '==', siteId));
  return onSnapshot(
    q,
    (snap) => {
      const out = {};
      let lines = 0;
      let noItem = 0;
      let setCount = 0;
      const lotsByName = {};
      snap.docs.forEach((d) => {
        const v = d.data();
        if ((v.items || []).some((ln) => Number(ln.receivedQty) > 0)) {
          for (const lot of setLotsOf(v)) {
            setCount += lot.count;
            lotsByName[lot.name] = (lotsByName[lot.name] || 0) + lot.count;
          }
        }
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
      cb(out, { purchases: snap.size, lines, noItem, setCount, lotsByName });
    },
    (err) => {
      console.error('[도급 세트] 발주 입고 구독 오류:', err);
      cb({}, { purchases: 0, lines: 0, noItem: 0, setCount: 0, lotsByName: {} });
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
// onByBox: { [box]: true|false } — 도급 줄이 전부 찬 BOX 만 켠다
function matPatch(panel, onByBox) {
  const today = new Date().toISOString().slice(0, 10);
  const 박스입고 = { ...(panel.박스입고 || {}) };
  const 박스입고일자 = { ...(panel.박스입고일자 || {}) };
  const 부품상태 = { ...(panel.부품상태 || {}) };
  for (const [box, on] of Object.entries(onByBox)) {
    if (!CHECKABLE_BOXES.includes(box)) continue;
    const mat = { ...boxMat(panel, box), 자재_도급: !!on };
    박스입고[box] = mat;
    박스입고일자[box] = { ...boxMatDate(panel, box), 자재_도급: on ? today : '' };
    부품상태[box] = deriveBoxStatus(panel, box, panel.검수, mat);
  }
  return { 박스입고, 박스입고일자, 부품상태 };
}

// 이 호기에서 일시 제외한 줄 id 들
function skippedRows(rows, mats) {
  return rows.filter((r) => mats?.[r.box || '']?.[r.id]?.skip).map((r) => r.id);
}

// 계획대로 BOX 별 기록을 쓴다 — 줄의 total 을 그대로
async function writePlan(panelId, plan, by) {
  const byBox = {};
  for (const l of plan.lines) (byBox[l.box] ||= []).push({ id: l.id, qty: l.total });
  await Promise.all(Object.entries(byBox).map(([box, entries]) => setReceivedMany(panelId, box, entries, by)));
}

/**
 * 세트 하나를 이 호기에 — 도급 줄을 「있는 만큼만」 채우고, 다 찬 BOX 만 자재 도급 칸을 켠다.
 * spareByItem 이 없으면(예전 호출) 전부 BOM 수량대로. → 부족 줄 수를 돌려준다.
 */
export async function assignPaidSet(panel, variantRows, { by = '', seq = 0, spareByItem = null, exclude = [] } = {}) {
  const rows = Object.values(paidRowsByBox(variantRows)).flat();
  const mats = await getPanelMaterials(panel.id);
  const plan = fillPlan({
    rows,
    spareByItem: spareByItem || Object.fromEntries(rows.map((r) => [r.itemId, Infinity])),
    exclude,
    skipRows: skippedRows(rows, mats),
  });
  await writePlan(panel.id, plan, by);
  await updatePanel(panel.id, {
    ...matPatch(panel, plan.boxes),
    paidSet: { seq, at: new Date().toISOString().slice(0, 10), by, short: plan.short },
  });
  return plan.short;
}

/**
 * 나중에 들어온 부족분을 채운다 — 이미 있는 것은 두고 모자란 줄만, 있는 만큼만.
 * stockByItem 을 주면 발주 여유가 없는 줄은 창고 재고에서 꺼내 채우고, 재고 장부를 그만큼 줄인다
 * (이력 「도급 배정 · 호기」). 꺼낸 양은 paidSet.stockUsed 에 쌓아 두었다가 배정 취소 때 되돌린다.
 * 돌려주는 값: { added 채운 줄 수, short 남은 부족 줄 수, stockUsed { itemId: n } }
 */
export async function topUpPaidSet(
  panel,
  variantRows,
  { by = '', spareByItem = {}, exclude = [], stockByItem = null } = {},
) {
  const rows = Object.values(paidRowsByBox(variantRows)).flat();
  const mats = await getPanelMaterials(panel.id);
  const current = {};
  for (const r of rows) current[r.id] = Number(mats?.[r.box || '']?.[r.id]?.qty) || 0;
  const plan = fillPlan({ rows, spareByItem, exclude, current, skipRows: skippedRows(rows, mats), stockByItem });
  const changed = plan.lines.filter((l) => l.add > 0);
  if (changed.length === 0) return { added: 0, short: plan.short, stockUsed: {} };
  await writePlan(panel.id, { lines: changed }, by);
  const used = plan.stockUsed || {};
  const prev = panel.paidSet?.stockUsed || {};
  const merged = { ...prev };
  for (const [id, n] of Object.entries(used)) merged[id] = (Number(merged[id]) || 0) + n;
  await updatePanel(panel.id, {
    ...matPatch(panel, plan.boxes),
    paidSet: {
      ...(panel.paidSet || {}),
      short: plan.short,
      toppedAt: new Date().toISOString().slice(0, 10),
      ...(Object.keys(used).length ? { stockUsed: merged } : {}),
    },
  });
  // 재고 장부 차감 — 발주 차감과 같은 「얼마를 뺀다」 방식이라 동시에 눌러도 어긋나지 않는다
  await Promise.all(
    Object.entries(used).map(([id, n]) =>
      consumeItemStock(id, n, { byName: by, note: `도급 배정 · ${panel.프로젝트 || ''}` }),
    ),
  );
  return { added: changed.length, short: plan.short, stockUsed: used };
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
  await updatePanel(panel.id, {
    ...matPatch(panel, Object.fromEntries(boxes.map((b) => [b, false]))),
    paidSet: deleteField(),
  });
  // 재고에서 꺼내 채웠던 양은 창고로 되돌린다
  const used = panel.paidSet?.stockUsed || {};
  await Promise.all(
    Object.entries(used)
      .filter(([, n]) => Number(n) > 0)
      .map(([id, n]) =>
        consumeItemStock(id, -Number(n), { byName: by, note: `도급 배정 취소로 되돌림 · ${panel.프로젝트 || ''}` }),
      ),
  );
}
