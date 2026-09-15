// 발주서 입고 체크가 통에 닿는 길. (2026-09-15 설계 「발주서 입고 체크 → 통 +」 2단계)
//
// 발주서 ──(bomProjectId)──▶ BOM 프로젝트 ──(회사 칸)──▶ 그 회사의 도급·판금 통
//
// 굳히기 전에는 통 qty 를 건드리지 않고 기록만 남긴다(그동안 도급 남음은 발주서를 다시 세서
// 얻으므로 더하면 두 번 센다). 굳힌 회사·갈래만 qty 가 움직인다 — ledgerOn 이 가른다.
import { getBomProjectById, getBomBySite } from './bomService';
import { getPaidSetSettings } from './paidSetService';
import { noteOrderIntake } from './stockService';
import { ledgerOn, stockKindOf } from '../domain/stockLedger';

/** 발주서가 걸린 BOM 프로젝트 — 직결(bomProjectId)이 먼저, 없으면 연결 목록의 첫 것 */
export function projectIdOfPurchase(purchase) {
  return purchase?.bomProjectId || purchase?.bomLinks?.[0]?.projectId || '';
}

/**
 * 입고 전후 줄을 견주어 달라진 만큼을 통에 적는다.
 * @returns { noted 적은 줄 수, missingCompany BOM 프로젝트에 회사가 없어 못 적음, noProject 발주서가 BOM 에 안 걸림 }
 */
export async function recordPurchaseIntake(purchase, prevItems, nextItems, { by = '' } = {}) {
  const pid = projectIdOfPurchase(purchase);
  if (!pid) return { noted: 0, noProject: true };
  const project = await getBomProjectById(pid);
  const company = String(project?.회사 || '').trim();
  if (!company) return { noted: 0, missingCompany: true, projectName: project?.name || '' };

  // 그 프로젝트 BOM 에서 이 품목이 어느 갈래인지 — 판금 줄이 하나라도 있으면 판금, 아니면 도급.
  // 사급 줄뿐인 품목은 발주서로 살 일이 없으니 통에 적지 않는다.
  const [rows, settings] = await Promise.all([getBomBySite(pid), getPaidSetSettings()]);
  const kindOfItem = (itemId) => {
    const ks = new Set(rows.filter((r) => r.itemId === itemId).map(stockKindOf));
    if (ks.has('made')) return 'made';
    if (ks.has('paid')) return 'paid';
    return ks.size === 0 ? 'paid' : null; // BOM 에 없는 품목도 우리가 산 것 — 도급 통
  };

  const prev = prevItems || [];
  const next = nextItems || [];
  const note = purchase?.title || purchase?.subject || purchase?.name || '발주서';
  let noted = 0;
  for (let i = 0; i < next.length; i += 1) {
    const it = next[i];
    if (!it?.itemId) continue;
    const d = (Number(it.receivedQty) || 0) - (Number(prev[i]?.receivedQty) || 0);
    if (d === 0) continue;
    const kind = kindOfItem(it.itemId);
    if (!kind) continue;
    await noteOrderIntake(kind, company, it, d, {
      by,
      note,
      apply: ledgerOn(settings, company, kind),
    });
    noted += 1;
  }
  return { noted };
}
