import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getBomBySite, bomItemsForVariant } from './bomService';
import { getPanelMaterials } from './panelMaterialsService';
import { updatePanel } from './productionService';
import { assignPaidSet, topUpPaidSet } from './paidSetService';
import { consumedByItem } from '../domain/paidSets';
import { makeBomLink } from '../domain/panelBom';
import { primaryBomProjectId } from '../domain/purchaseBom';

// 발주 입고 → 걸린 호기에 자동 배분 (2026-09-05 대표님 안 B 4단계).
//
// 발주서에 「생산 호기」가 걸려 있고 BOM 에서 가져온 발주서면, 입고 처리 뒤 걸린 호기 순서대로
// 도급 자재를 채운다 — 도급 배정 화면의 「세트 배정」·「부족분 채우기」와 같은 로직(assignPaidSet·
// topUpPaidSet)을 그대로 쓴다. 여유(입고 − 이미 배정된 호기가 가져간 양)가 있는 만큼만 채우고,
// 모자라면 뒤 호기가 부족으로 남는다.
//
// 돌려주는 값: { skipped: 이유 | null, assigned: [호기명], topped: [호기명], short: [{ name, short }], noType: [호기명] }

const panelsRef = collection(db, 'productionPanels');
const purchasesRef = collection(db, 'purchases');

function panelName(p) {
  return `${p?.프로젝트 || ''}${p?.호기 ? ` ${p.호기}` : ''}`.trim() || '(이름 없음)';
}

/** 이 BOM 프로젝트로 들어온 발주 입고 합 { itemId: qty } — bomProjectId 로 직결된 발주서 + (옛 방식) 설정된 현장의 발주서 */
async function receivedForProject(projectId, company) {
  const seen = new Set();
  const out = {};
  const add = (snap) => {
    snap.docs.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      for (const ln of d.data().items || []) {
        const got = Number(ln.receivedQty) || 0;
        if (got > 0 && ln.itemId) out[ln.itemId] = (out[ln.itemId] || 0) + got;
      }
    });
  };
  add(await getDocs(query(purchasesRef, where('bomProjectId', '==', projectId))));
  if (company) {
    const settings = await getDoc(doc(db, 'settings', 'paidSets'));
    const siteId = settings.exists() ? settings.data()?.[company]?.siteId : '';
    if (siteId) add(await getDocs(query(purchasesRef, where('siteId', '==', siteId))));
  }
  return out;
}

export async function autoAllocateFromPurchase(purchase, { by = '' } = {}) {
  const result = { skipped: null, assigned: [], topped: [], short: [], noType: [] };
  const links = Array.isArray(purchase?.bomLinks) ? purchase.bomLinks.filter((l) => l?.projectId) : [];
  const projectId = primaryBomProjectId(purchase);
  const wanted = Array.isArray(purchase?.panels) ? purchase.panels.filter((p) => p?.id) : [];
  if (!projectId || links.length === 0) return { ...result, skipped: 'BOM 에서 가져온 발주서가 아닙니다' };
  if (wanted.length === 0) return { ...result, skipped: '생산 호기를 걸지 않았습니다' };
  if (!(purchase.items || []).some((ln) => Number(ln.receivedQty) > 0))
    return { ...result, skipped: '입고된 줄이 없습니다' };

  // 호기 문서 — 걸린 호기(순서대로) + 같은 BOM 을 쓰는 배정 호기(여유 셈용)
  const wantedDocs = await Promise.all(wanted.map((p) => getDoc(doc(db, 'productionPanels', p.id))));
  const targets = wantedDocs.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
  if (targets.length === 0) return { ...result, skipped: '걸린 호기를 찾지 못했습니다' };
  const company = targets[0].회사 || '';
  const linkedSnap = await getDocs(query(panelsRef, where('bomLink.projectId', '==', projectId)));
  const linked = new Map(linkedSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  const bomRows = await getBomBySite(projectId);
  const received = await receivedForProject(projectId, company);
  // 이미 배정된 호기들이 가져간 양 — 타입과 무관하게 같은 품목이면 같은 통에서 나간다
  const assignedPanels = [...linked.values()].filter((p) => p.paidSet);
  const mats = await Promise.all(assignedPanels.map((p) => getPanelMaterials(p.id)));
  const consumed = consumedByItem(bomRows, mats);
  const spare = {};
  for (const [itemId, got] of Object.entries(received)) spare[itemId] = got - (consumed[itemId] || 0);

  const takeFromSpare = (lines) => {
    for (const l of lines || []) {
      if (!l.itemId || !(l.add > 0)) continue;
      spare[l.itemId] = (spare[l.itemId] || 0) - (l.add - (l.fromStock || 0));
    }
  };

  for (const t of targets) {
    let panel = linked.get(t.id) || t;
    // BOM 을 아직 안 건 호기 — 발주서 타입이 하나뿐이면 그걸로 연결한다
    if (!panel.bomLink?.projectId) {
      if (links.length !== 1) {
        result.noType.push(panelName(panel));
        continue;
      }
      const bomLink = makeBomLink(links[0]);
      await updatePanel(panel.id, { bomLink });
      panel = { ...panel, bomLink };
    }
    if (panel.bomLink.projectId !== projectId) continue; // 다른 BOM 호기 — 건드리지 않는다
    const rows = bomItemsForVariant(bomRows, panel.bomLink.variantKey || '');
    if (panel.paidSet) {
      const r = await topUpPaidSet(panel, rows, { by, spareByItem: spare });
      takeFromSpare(r.lines);
      if (r.added > 0) result.topped.push(panelName(panel));
      if (r.short > 0) result.short.push({ name: panelName(panel), short: r.short });
    } else {
      const sameType = [...linked.values()].filter(
        (p) => p.paidSet && (p.bomLink?.variantKey || '') === (panel.bomLink.variantKey || ''),
      ).length;
      const r = await assignPaidSet(panel, rows, { by, seq: sameType + 1, spareByItem: spare });
      takeFromSpare(r.lines);
      linked.set(panel.id, { ...panel, paidSet: { seq: sameType + 1 } });
      result.assigned.push(panelName(panel));
      if (r.short > 0) result.short.push({ name: panelName(panel), short: r.short });
    }
  }
  return result;
}

/** 결과를 토스트 한 줄로 */
export function allocationSummary(r) {
  if (!r) return '';
  if (r.skipped) return '';
  const parts = [];
  if (r.assigned.length) parts.push(`${r.assigned.join(', ')} 배정`);
  if (r.topped.length) parts.push(`${r.topped.join(', ')} 부족분 채움`);
  if (r.short.length) parts.push(`아직 부족: ${r.short.map((s) => `${s.name} ${s.short}줄`).join(', ')}`);
  if (r.noType.length) parts.push(`타입을 몰라 건너뜀: ${r.noType.join(', ')}`);
  return parts.length ? `도급 자재 자동 배분 — ${parts.join(' · ')}` : '';
}
