// 발주서 입고 체크가 통에 닿는 길. (2026-09-15 설계 「발주서 입고 체크 → 통 +」 2단계)
//
// 발주서 ──(bomProjectId)──▶ BOM 프로젝트 ──(회사 칸)──▶ 그 회사의 도급·판금 통
//
// 굳히기 전에는 통 qty 를 건드리지 않고 기록만 남긴다(그동안 도급 남음은 발주서를 다시 세서
// 얻으므로 더하면 두 번 센다). 굳힌 회사·갈래만 qty 가 움직인다 — ledgerOn 이 가른다.
import { getBomProjectById, getBomBySite } from './bomService';
import { getPanelCompaniesByBom } from './productionService';
import { getPaidSetSettings } from './paidSetService';
import { noteOrderIntake } from './stockService';
import { ledgerOn, stockKindOf } from '../domain/stockLedger';

/** 발주서가 걸린 BOM 프로젝트 — 직결(bomProjectId)이 먼저, 없으면 연결 목록의 첫 것 */
function projectIdOfPurchase(purchase) {
  return purchase?.bomProjectId || purchase?.bomLinks?.[0]?.projectId || '';
}

/**
 * 입고 전후 줄을 견주어 달라진 만큼을 통에 적는다.
 * @returns { noted 적은 줄 수, missingCompany BOM 프로젝트에 회사가 없어 못 적음, noProject 발주서가 BOM 에 안 걸림 }
 */
/**
 * 이 발주서가 닿는 통 — 회사·품목별 갈래·통 설정. 입고 기록과 발주서 화면의 「재고」 칸이 같은
 * 규칙을 써야 한 통을 본다 (2026-09-21 대표님 「발주서에서 도급 재고 수량을 못불러 오는것같은데」).
 * @returns { company, kindOfItem(itemId), settings, projectName, noProject, missingCompany }
 */
export async function resolvePurchaseTong(purchase) {
  const pid = projectIdOfPurchase(purchase);
  if (!pid) return { company: '', kindOfItem: () => 'paid', settings: null, noProject: true };
  const project = await getBomProjectById(pid);
  const [rows, settings] = await Promise.all([getBomBySite(pid), getPaidSetSettings()]);
  // 회사는 세 길로 찾는다 — ① BOM 프로젝트에 적힌 회사 ② 발주서의 현장이 어느 회사 통에 묶였나(통 설정)
  // ③ 이 BOM 을 쓰는 생산현황 호기들의 회사(하나뿐일 때). 메티스 BOM 은 메티스 호기 34대가 쓰니
  // ③만으로도 잡힌다 — 사람이 회사 칸을 따로 안 채워도 통이 이어진다 (2026-09-21 대표님)
  let company = String(project?.회사 || '').trim();
  if (!company && purchase?.siteId) {
    company =
      Object.keys(settings || {}).find((k) => k !== 'updatedAt' && settings[k]?.siteId === purchase.siteId) || '';
  }
  if (!company) {
    const list = await getPanelCompaniesByBom(pid).catch(() => []);
    if (list.length === 1) company = list[0];
  }
  // 그 프로젝트 BOM 에서 이 품목이 어느 갈래인지 — 판금 줄이 하나라도 있으면 판금, 아니면 도급.
  // 사급 줄뿐인 품목은 발주서로 살 일이 없으니 통에 적지 않는다.
  const kindOfItem = (itemId) => {
    const ks = new Set(rows.filter((r) => r.itemId === itemId).map(stockKindOf));
    if (ks.has('made')) return 'made';
    if (ks.has('paid')) return 'paid';
    return ks.size === 0 ? 'paid' : null; // BOM 에 없는 품목도 우리가 산 것 — 도급 통
  };
  return { company, kindOfItem, settings, projectName: project?.name || '', missingCompany: !company };
}

export async function recordPurchaseIntake(purchase, prevItems, nextItems, { by = '' } = {}) {
  const t = await resolvePurchaseTong(purchase);
  if (t.noProject) return { noted: 0, noProject: true };
  const { company, kindOfItem, settings } = t;
  if (!company) return { noted: 0, missingCompany: true, projectName: t.projectName };

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
