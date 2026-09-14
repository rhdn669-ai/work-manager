import { collection, doc, onSnapshot, query, where, deleteField } from '../config/data';
import { db } from '../config/data';
import { updatePanel } from './productionService';
import { setReceivedMany, getPanelMaterials, setReceived, addFromStock } from './panelMaterialsService';
import { isFreeIssue } from './bomService';
import { CHECKABLE_BOXES, bomRowsForBox } from '../domain/panelBom';
import { boxMat, boxMatDate, deriveBoxStatus } from '../domain/production';
import { fillPlan } from '../domain/paidSets';
import { setLotsOf } from '../utils/setLots';

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

/**
 * 발주서 직결 구독 (2026-09-05 안 B 3단계) — BOM 프로젝트로 직결된 발주서(bomProjectId) 와
 * (옛 방식) 설정한 현장의 발주서를 합쳐 센다. 둘 다 없으면 아무것도 안 한다.
 */
export function subscribeReceivedFor({ siteId = '', bomProjectId = '' } = {}, cb) {
  const qs = [];
  if (bomProjectId) qs.push(query(purchasesRef, where('bomProjectId', '==', bomProjectId)));
  if (siteId) qs.push(query(purchasesRef, where('siteId', '==', siteId)));
  if (qs.length === 0) return () => {};

  // 그 현장에서 산 것이면 무엇이든 세면 세트와 무관한 단품까지 통에 섞인다 — 「매니아 9월
  // 선결제」 63개가 그렇게 들어왔다 (2026-09-12 대표님 「9월선결제 아직 입고전임」).
  // 그렇다고 BOM 에 건 것만 세면 이번에는 세트 발주서가 떨어져 나간다 — 「M 8월 1차」는
  // 세트 7 이 적힌 BOM 발주서인데 bomProjectId 가 비어 있어, 7개가 통째로 빠졌다
  // (대표님 「13세트 입고됐는데 왜 12셋이지」).
  // 그래서 가르는 잣대는 «세트가 적혀 있는가»로 둔다. BOM 에 건 것은 무조건 센다.
  const counted = (v) => {
    if (bomProjectId && v?.bomProjectId === bomProjectId) return true;
    return setLotsOf(v).some((l) => Number(l.count) > 0);
  };
  const parts = qs.map(() => null); // 구독마다 마지막 스냅샷의 문서들
  const emit = () => {
    // 한 갈래만 온 채로 내면 절반 값이 잠깐 보인다 — 다 온 뒤에만 낸다 (2026-09-14)
    if (parts.some((d) => d === null)) return;
    const byId = new Map();
    parts.forEach((docs) => (docs || []).forEach((d) => byId.set(d.id, d)));
    summarize([...byId.values()], cb);
  };
  const unsubs = qs.map((q, i) =>
    onSnapshot(
      q,
      (snap) => {
        parts[i] = snap.docs.map((d) => ({ id: d.id, data: d.data() })).filter((d) => counted(d.data));
        emit();
      },
      (err) => {
        console.error('[도급 배정] 발주 입고 구독 오류:', err);
        parts[i] = [];
        emit();
      },
    ),
  );
  return () => unsubs.forEach((u) => u());
}

function summarize(docs, cb) {
  const out = {};
  let lines = 0;
  let noItem = 0;
  let setCount = 0;
  const lotsByName = {};
  docs.forEach((d) => {
    const v = d.data;
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
  cb(out, { purchases: docs.length, lines, noItem, setCount, lotsByName });
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
  if (changed.length === 0) return { added: 0, short: plan.short, stockUsed: {}, lines: [] };
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
  // 재고를 따로 깎지 않는다 — 위에서 늘어난 「나감」이 곧 재고가 줄어든 것이다 (위 설명 참고).
  return { added: changed.length, short: plan.short, stockUsed: used, lines: changed };
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
  // 되돌릴 것도 없다 — 위에서 호기 수량을 0 으로 만들었으니 「나감」이 줄어 남음이 저절로 돌아온다.
}

/**
 * 부족한 줄 하나를 창고 재고에서 끌어와 채운다 (2026-09-05 대표님 「부족한 거 재고에서 땡겨오는 버튼」).
 * 들어온 개수를 n 만큼 올리고 재고 장부를 n 줄인다(이력 「도급 배정 · 호기」). 세트 배정 호기면
 * paidSet.stockUsed 에 쌓아 두어 배정 취소 때 되돌린다. BOX 자재 칸은 자재 체크 화면 연동이 맞춘다.
 */
export async function pullRowFromStock(panel, row, { box, have = 0, n = 0, by = '', fromStock = 0 } = {}) {
  const qty = Math.max(0, Number(n) || 0);
  if (!qty || !row?.itemId) return 0;
  await setReceived(panel.id, box, row.id, (Number(have) || 0) + qty, by);
  await addFromStock(panel.id, box, row.id, qty, fromStock); // 기록에 「재고 N」
  // 여기서 재고를 또 빼지 않는다. 도급 남음은 «발주 입고 + 손으로 적은 몫 − 나감»으로 세므로,
  // 위에서 나감이 늘어난 것만으로 남음이 이미 줄었다. 재고에서 한 번 더 빼면 두 번 깎인다
  // (2026-09-12 실측: 4개씩 네 번 가져왔는데 남음이 32 줄었다).
  if (panel.paidSet) {
    const used = { ...(panel.paidSet.stockUsed || {}) };
    used[row.itemId] = (Number(used[row.itemId]) || 0) + qty;
    await updatePanel(panel.id, { paidSet: { ...panel.paidSet, stockUsed: used } });
  }
  return qty;
}
