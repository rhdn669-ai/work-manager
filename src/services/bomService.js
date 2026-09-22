import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from '../config/data';
import { db } from '../config/data';
import { PAIR_DEFAULT, pairPatch, pairCopy, twinOf } from '../domain/bomPair';
import { rowsForVariant } from '../domain/panelBom';

const bomRef = collection(db, 'bom');
const projectsRef = collection(db, 'bomProjects');

// ---- 프로젝트 (BOM 그룹) ----
// order(수동 순서)가 있으면 그 순서로, 없으면 최신 등록순
export async function getBomProjects() {
  const snap = await getDocs(projectsRef);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hasOrder = list.some((p) => typeof p.order === 'number');
  if (hasOrder) {
    return list.sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : 1e9;
      const bo = typeof b.order === 'number' ? b.order : 1e9;
      if (ao !== bo) return ao - bo;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
  }
  return list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

// 드래그 순서변경 — 전달된 id 순서대로 order 저장
export async function saveBomProjectsOrder(orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.update(doc(db, 'bomProjects', id), { order: idx, updatedAt: new Date() });
  });
  await batch.commit();
}

export async function getBomProjectById(id) {
  const snap = await getDoc(doc(db, 'bomProjects', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function addBomProject(name) {
  return addDoc(projectsRef, {
    name: String(name || '').trim(),
    createdAt: new Date(),
  });
}

/**
 * 프로젝트 수정 — 이름(문자열) 또는 { name, 회사 } 묶음.
 * 「회사」는 발주서 입고가 어느 회사의 도급·판금 통으로 갈지 정한다
 * (2026-09-15 설계 「발주 입고가 어느 회사 통으로 가나」).
 */
export async function updateBomProject(projectId, patch) {
  const p = typeof patch === 'string' ? { name: patch } : patch || {};
  const data = { updatedAt: new Date() };
  if (p.name !== undefined) data.name = String(p.name || '').trim();
  if (p.회사 !== undefined) data.회사 = String(p.회사 || '').trim();
  await updateDoc(doc(db, 'bomProjects', projectId), data);
}

// ---- 짝 BOM ----
// 같은 판넬, 고객사만 다른 BOM 둘을 묶는다. 한쪽을 고치면 다른 쪽도 같이 바뀐다 (domain/bomPair.js).
// 짝은 «양쪽 프로젝트 문서에 같은 내용»으로 적어, 어느 쪽에서 열어도 같은 짝이 보인다.
export async function getBomPair(projectId) {
  const p = await getBomProjectById(projectId);
  const pair = p?.pair;
  if (!pair?.projectId) return null;
  return { projectId: pair.projectId, sync: { ...PAIR_DEFAULT, ...(pair.sync || {}) }, mine: p };
}

export async function setBomPair(projectId, pairId, sync) {
  if (!projectId || !pairId || projectId === pairId) throw new Error('짝은 다른 BOM 이어야 합니다');
  // 어느 한쪽이 이미 딴 BOM 과 짝이면 그 짝부터 푼다 — 세 개가 엉키지 않게
  for (const id of [projectId, pairId]) {
    const cur = await getBomPair(id);
    if (cur && cur.projectId !== projectId && cur.projectId !== pairId)
      await updateDoc(doc(db, 'bomProjects', cur.projectId), { pair: null, updatedAt: new Date() });
  }
  const s = { ...PAIR_DEFAULT, ...(sync || {}) };
  await updateDoc(doc(db, 'bomProjects', projectId), { pair: { projectId: pairId, sync: s }, updatedAt: new Date() });
  await updateDoc(doc(db, 'bomProjects', pairId), { pair: { projectId, sync: s }, updatedAt: new Date() });
}

export async function clearBomPair(projectId) {
  const cur = await getBomPair(projectId);
  await updateDoc(doc(db, 'bomProjects', projectId), { pair: null, updatedAt: new Date() });
  if (cur?.projectId) await updateDoc(doc(db, 'bomProjects', cur.projectId), { pair: null, updatedAt: new Date() });
}

/** 연동에 필요한 것 한 묶음 — 짝이 없으면 null */
async function pairCtx(siteId) {
  const pr = await getBomPair(siteId);
  if (!pr) return null;
  const theirs = await getBomProjectById(pr.projectId);
  if (!theirs) return null;
  const theirRows = await getBomBySite(pr.projectId);
  // 내 줄도 함께 — 같은 열쇠가 여럿일 때 «몇 번째»를 맞추려면 내 목록이 있어야 한다
  // (2026-09-22 대표님 「A ㄱㄱ」)
  const myRows = await getBomBySite(siteId);
  return {
    pairId: pr.projectId,
    sync: pr.sync,
    myVariants: Array.isArray(pr.mine?.variants) ? pr.mine.variants : [],
    theirVariants: Array.isArray(theirs.variants) ? theirs.variants : [],
    theirRows,
    myRows,
  };
}

/** 줄 하나를 휴지통으로 — 짝 BOM 의 같은 줄도 함께. @returns 짝에서도 지웠으면 1 */
export async function trashBomItem(id, meta, by, { sync = true } = {}) {
  clearBomCache();
  const snap = await getDoc(doc(db, 'bom', id));
  const prev = snap.exists() ? { id, ...snap.data() } : null;
  const { trashGeneric } = await import('./trashService');
  await trashGeneric('bom', id, meta, by);
  if (!sync || !prev?.siteId) return 0;
  try {
    const ctx = await pairCtx(prev.siteId);
    if (!ctx) return 0;
    const twin = twinOf(prev, ctx.myVariants, ctx.theirRows, ctx.theirVariants, ctx.myRows);
    if (!twin) return 0;
    await trashGeneric('bom', twin.id, { ...(meta || {}), summary: '짝 BOM 연동 삭제' }, by);
    clearBomCache(ctx.pairId);
    return 1;
  } catch (err) {
    console.error('[짝 BOM] 삭제 연동 실패', err);
    return 0;
  }
}

// ---- 타입(형번) ----
// 같은 제품인데 형번마다 자재가 조금씩 다를 때, BOM을 여러 벌 만들지 않고 한 벌로 관리한다.
// 두 벌로 나눠 두면 자재가 바뀔 때마다 양쪽을 다 고쳐야 해서 한쪽을 빠뜨리기 쉽다.
//
// 프로젝트: variants [{ key, label }]  — key 는 라벨을 바꿔도 그대로인 식별자
// 품목:     variantKeys []             — 비어 있으면 '공통'(모든 타입에 들어감),
//                                        값이 있으면 그 타입에서만 쓰인다
export async function setBomVariants(projectId, variants) {
  await updateDoc(doc(db, 'bomProjects', projectId), {
    variants: (variants || []).map((v) => ({ key: v.key, label: String(v.label || '').trim() })),
    updatedAt: new Date(),
  });
}

// 타입을 지우면 그 타입에만 속하던 품목이 어디에도 안 잡히게 된다.
// 남은 타입이 없으면 공통으로 되돌려 품목이 사라지지 않게 한다.
export async function removeBomVariant(projectId, key) {
  const proj = await getBomProjectById(projectId);
  const next = (proj?.variants || []).filter((v) => v.key !== key);
  const items = await getBomBySite(projectId);
  const batch = writeBatch(db);
  for (const b of items) {
    const ks = Array.isArray(b.variantKeys) ? b.variantKeys : [];
    if (!ks.includes(key)) continue;
    batch.update(doc(db, 'bom', b.id), { variantKeys: ks.filter((k) => k !== key), updatedAt: new Date() });
  }
  batch.update(doc(db, 'bomProjects', projectId), { variants: next, updatedAt: new Date() });
  await batch.commit();
}

// 한 타입으로 발주할 때 실제로 들어가는 품목 — 공통 + 그 타입 전용
// 타입에 맞는 줄만 — 수량도 그 타입 값으로 바꿔 준다(domain/panelBom.rowsForVariant).
// 호기 자재 체크와 발주서 「BOM 가져오기」가 모두 이 한 곳을 지나므로, 타입별 수량은 여기서 한 번만 푼다.
export function bomItemsForVariant(items, variantKey) {
  return rowsForVariant(items, variantKey);
}

// BOM 프로젝트 복사 — 프로젝트 문서 + 품목 전체(BOX·순서 포함)를 새 프로젝트로 복제
/** 이 BOM 이 어느 현장 것인지 — 발주서에서 BOM 을 고를 때 그 현장 것만 보이게 한다
 *  (2026-09-12 대표님 「프로버 메티스로 발주서를 골랐는데 다른 프로젝트꺼 전부 뜰필요가있나?」) */
export async function setBomProjectSite(projectId, siteId, siteName) {
  await updateDoc(doc(projectsRef, projectId), { siteId: siteId || '', siteName: siteName || '' });
}

export async function duplicateBomProject(projectId, newName) {
  const src = await getBomProjectById(projectId);
  if (!src) throw new Error('원본 프로젝트를 찾을 수 없습니다');
  const newRef = await addDoc(projectsRef, {
    name: String(newName || `${src.name} (복사)`).trim(),
    createdAt: new Date(),
  });
  const items = await getBomBySite(projectId);
  // writeBatch는 500건 제한 — BOM 품목 수백 건 수준이므로 450개씩 분할
  for (let i = 0; i < items.length; i += 450) {
    const batch = writeBatch(db);
    items.slice(i, i + 450).forEach((b) => {
      const { id: _id, siteId: _s, createdAt: _c, updatedAt: _u, ...data } = b;
      batch.set(doc(bomRef), {
        ...data,
        siteId: newRef.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await batch.commit();
  }
  return newRef.id;
}

export async function deleteBomProject(projectId) {
  const snap = await getDocs(query(bomRef, where('siteId', '==', projectId)));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'bomProjects', projectId));
  await batch.commit();
}

// 프로젝트별 BOM 항목 조회 (order 순)
// 같은 BOM 을 여러 화면이 반복해서 읽지 않게 잠깐 담아 둔다 (2026-09-05 대표님).
// BOM 을 고치는 곳에서 clearBomCache() 로 비운다.
const bomCache = new Map();
const BOM_TTL = 60000;

export function clearBomCache(siteId) {
  if (siteId) bomCache.delete(siteId);
  else bomCache.clear();
}

export async function getBomBySite(siteId) {
  if (!siteId) return [];
  const hit = bomCache.get(siteId);
  if (hit && Date.now() - hit.at < BOM_TTL) return hit.rows;
  const rows = await fetchBomBySite(siteId);
  bomCache.set(siteId, { at: Date.now(), rows });
  return rows;
}

async function fetchBomBySite(siteId) {
  try {
    const q = query(bomRef, where('siteId', '==', siteId), orderBy('order'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // composite index 미생성 환경 fallback — 클라이언트 정렬
    const q = query(bomRef, where('siteId', '==', siteId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
}

export async function addBomItem(siteId, data, { sync = true } = {}) {
  clearBomCache(siteId);
  const ref = await addDoc(bomRef, {
    siteId,
    itemId: data.itemId || '',
    name: data.name || '',
    spec: data.spec || '',
    unit: data.unit || '',
    qty: Number(data.qty) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    box: data.box || '',
    note: data.note || '',
    // 사급 = 고객사 제공 자재. 우리 돈이 안 나가므로 금액 합계에서 뺀다.
    // 빈 값이 도급(우리가 사서 넣는 것) — 지금까지의 모든 품목이 그렇다 (2026-09-02 대표님).
    supplyType: data.supplyType || '',
    // 도번 — 도면 번호. 품목 코드와 나란히 다니며 현장에서 도면을 찾는 열쇠가 된다
    // (2026-09-02 대표님). 발주서로도 그대로 따라간다.
    drawingNo: data.drawingNo || '',
    variantKeys: data.variantKeys || [], // 비어 있으면 공통
    qtyByVariant: data.qtyByVariant && typeof data.qtyByVariant === 'object' ? data.qtyByVariant : {},
    dirs: Array.isArray(data.dirs) ? data.dirs : [],
    dirHide: !!data.dirHide, // 옛 칸 — 읽을 때 폴백으로만 쓴다
    // 방향마다 셈/안 셈/없음 (2026-09-22 대표님 「정방향만 쓰는데 수량 체크를 안하는 선택지는?」)
    dirState: data.dirState && typeof data.dirState === 'object' ? data.dirState : {}, // 정·역 — 비어 있으면 공통 (2026-09-21 대표님)
    order: Number(data.order) || 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  // 짝 BOM 에도 같은 줄을 — 실패해도 내 줄은 이미 들어갔으니 알리기만 한다
  if (sync) {
    try {
      const ctx = await pairCtx(siteId);
      if (ctx) {
        await addDoc(bomRef, {
          siteId: ctx.pairId,
          ...pairCopy(data, ctx.sync, ctx.myVariants, ctx.theirVariants, ctx.theirRows),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        clearBomCache(ctx.pairId);
      }
    } catch (err) {
      console.error('[짝 BOM] 줄 추가 연동 실패', err);
    }
  }
  return ref;
}

// 드래그 순서변경 — 전달된 id 순서대로 order 저장 (프로젝트 목록 saveBomProjectsOrder와 동일 패턴)
// ※ 발주서 품목은 가져올 때 복사본이므로 기존 발주서에는 영향 없음 — 이후 「품목 불러오기」부터 새 순서 적용
export async function saveBomItemsOrder(orderedIds, { sync = true } = {}) {
  clearBomCache();
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.update(doc(db, 'bom', id), { order: idx, updatedAt: new Date() });
  });
  await batch.commit();
  // 짝 BOM 의 같은 줄들도 같은 순서로 — 짝에 없는 줄은 건너뛴다
  if (!sync || orderedIds.length === 0) return;
  try {
    const first = await getDoc(doc(db, 'bom', orderedIds[0]));
    const siteId = first.exists() ? first.data()?.siteId : '';
    if (!siteId) return;
    const ctx = await pairCtx(siteId);
    if (!ctx) return;
    const mine = await getBomBySite(siteId);
    const byId = new Map(mine.map((r) => [r.id, r]));
    const b2 = writeBatch(db);
    let n = 0;
    orderedIds.forEach((id, idx) => {
      const row = byId.get(id);
      const twin = row && twinOf(row, ctx.myVariants, ctx.theirRows, ctx.theirVariants, mine);
      if (!twin) return;
      b2.update(doc(db, 'bom', twin.id), { order: idx, updatedAt: new Date() });
      n += 1;
    });
    if (n > 0) await b2.commit();
    clearBomCache(ctx.pairId);
  } catch (err) {
    console.error('[짝 BOM] 순서 연동 실패', err);
  }
}

/**
 * 줄 하나 고치기. 어느 길(칸 수정·이력 되돌리기·품목 바꾸기)로 고치든 다 여기를 지나므로,
 * «BOX 바뀌면 호기 기록 옮기기»와 «짝 BOM 에 같이 적용»을 여기서 한 번만 잡는다 (2026-09-18 대표님).
 * @param opts.sync  짝 BOM 에도 적용할지 — 「다름 찾기」·「되돌리기」처럼 이 BOM 만 만질 때 false
 * @returns { moved, pair }  moved: 기록을 옮긴 호기 수 · pair: 'off' | 'ok' | 'missing'(짝에 같은 줄 없음) | 'error'
 */
export async function updateBomItem(id, data, { sync = true } = {}) {
  clearBomCache();
  const snap = await getDoc(doc(db, 'bom', id));
  const prev = snap.exists() ? { id, ...snap.data() } : null;
  let move = null;
  if (typeof data?.box === 'string') {
    const prevBox = prev?.box || '';
    if (prevBox && prevBox !== data.box) move = { from: prevBox, to: data.box };
  }
  await updateDoc(doc(db, 'bom', id), { ...data, updatedAt: new Date() });
  const { moveMaterialsBox } = await import('./panelMaterialsService');
  const moved = move ? await moveMaterialsBox(id, move.from, move.to) : 0;

  let pair = 'off';
  if (sync && prev?.siteId) {
    try {
      const ctx = await pairCtx(prev.siteId);
      if (ctx) {
        // 짝은 «고치기 전» 모습으로 찾는다 — BOX·타입이 바뀌는 고침이면 바뀐 뒤 모습으론 못 찾는다
        const twin = twinOf(prev, ctx.myVariants, ctx.theirRows, ctx.theirVariants, ctx.myRows);
        const patch = pairPatch(data, ctx.sync, ctx.myVariants, ctx.theirVariants, twin);
        if (!twin) pair = 'missing';
        else {
          if (patch) {
            await updateDoc(doc(db, 'bom', twin.id), { ...patch, updatedAt: new Date() });
            clearBomCache(ctx.pairId);
            if (typeof patch.box === 'string' && patch.box !== (twin.box || ''))
              await moveMaterialsBox(twin.id, twin.box || '', patch.box);
          }
          pair = 'ok';
        }
      }
    } catch (err) {
      console.error('[짝 BOM] 적용 실패', err);
      pair = 'error';
    }
  }
  return { moved, pair };
}

export async function deleteBomItem(id) {
  clearBomCache();
  await deleteDoc(doc(db, 'bom', id));
}

// 사급인가 — 고객사 제공 자재. 값이 'free' 인 것만 사급이고 나머지는 다 도급이다.
// 한 곳에서 가려야 화면·합계·발주 불러오기가 어긋나지 않는다 (2026-09-02 대표님).
export function isFreeIssue(item) {
  return (item?.supplyType || '') === 'free';
}

// 실행취소용 — 원래 id 그대로 복원
export async function restoreBomItem(id, siteId, data) {
  clearBomCache(siteId);
  await setDoc(doc(db, 'bom', id), {
    siteId,
    itemId: data.itemId || '',
    name: data.name || '',
    spec: data.spec || '',
    unit: data.unit || '',
    qty: Number(data.qty) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    box: data.box || '',
    note: data.note || '',
    supplyType: data.supplyType || '',
    drawingNo: data.drawingNo || '',
    variantKeys: data.variantKeys || [],
    qtyByVariant: data.qtyByVariant && typeof data.qtyByVariant === 'object' ? data.qtyByVariant : {},
    dirs: Array.isArray(data.dirs) ? data.dirs : [],
    dirHide: !!data.dirHide, // 옛 칸 — 읽을 때 폴백으로만 쓴다
    // 방향마다 셈/안 셈/없음 (2026-09-22 대표님 「정방향만 쓰는데 수량 체크를 안하는 선택지는?」)
    dirState: data.dirState && typeof data.dirState === 'object' ? data.dirState : {},
    order: Number(data.order) || 0,
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date(),
  });
}

// ── 수정 이력 (2026-09-03 대표님 「자꾸 수정이 돼 버려서 … 이력 확인·되돌리기」) ──
// 문서 하나 = 어떤 수정 «직전»의 BOM 전체 스냅샷. 되돌리기는 그 스냅샷으로 되쓰기.
//   { siteId, label, by, at(서버시각), atLocal 'YYYY-MM-DD HH:mm', count(묶인 수정 수), until, snapshot: [줄…] }
// 같은 사람이 같은 종류의 수정을 몇 분 안에 잇달아 하면 한 건으로 묶는다(칸 하나 고칠 때마다 쌓이지 않게).
const bomHistoryRef = collection(db, 'bomHistory');
const HISTORY_KEEP = 30;

export function snapshotBomRows(items) {
  return (items || []).map((b) => ({
    id: b.id,
    itemId: b.itemId || '',
    name: b.name || '',
    spec: b.spec || '',
    unit: b.unit || '',
    qty: Number(b.qty) || 0,
    unitPrice: Number(b.unitPrice) || 0,
    box: b.box || '',
    note: b.note || '',
    supplyType: b.supplyType || '',
    drawingNo: b.drawingNo || '',
    order: Number(b.order) || 0,
    variantKeys: Array.isArray(b.variantKeys) ? b.variantKeys : [],
    qtyByVariant: b.qtyByVariant && typeof b.qtyByVariant === 'object' ? b.qtyByVariant : {},
    dirs: Array.isArray(b.dirs) ? b.dirs : [],
    dirHide: !!b.dirHide,
    dirState: b.dirState && typeof b.dirState === 'object' ? b.dirState : {},
  }));
}

export async function addBomHistory(siteId, { label, by, snapshot }) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const atLocal = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
  const ref = await addDoc(bomHistoryRef, {
    siteId,
    label: label || '수정',
    by: by || '',
    at: now,
    atLocal,
    until: atLocal,
    count: 1,
    rows: snapshot.length,
    snapshot,
  });
  return ref.id;
}

export async function bumpBomHistory(id, count) {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  await updateDoc(doc(db, 'bomHistory', id), {
    count,
    until: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`,
  });
}

/** 최근 것부터. 색인 없이 쓰려고 정렬은 여기서 */
export async function listBomHistory(siteId) {
  const snap = await getDocs(query(bomHistoryRef, where('siteId', '==', siteId)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ms = (v) => (v?.toMillis ? v.toMillis() : v?.seconds ? v.seconds * 1000 : new Date(v).getTime() || 0);
  rows.sort((a, b) => ms(b.at) - ms(a.at));
  return rows;
}

/** 오래된 것은 지운다 — 프로젝트마다 최근 30건만 */
export async function pruneBomHistory(siteId) {
  const rows = await listBomHistory(siteId);
  const extra = rows.slice(HISTORY_KEEP);
  if (extra.length === 0) return 0;
  const batch = writeBatch(db);
  extra.forEach((r) => batch.delete(doc(db, 'bomHistory', r.id)));
  await batch.commit();
  return extra.length;
}
