// 발주서(구매발주) 공용 순수 헬퍼 — PurchaseDetailPage(실시간 출력/메일)와
// 저장본 일괄 재생성 도구가 "동일한" 양식·번호 규칙을 쓰도록 한 곳에 모은다.
// 여기 로직이 갈라지면 저장본과 실제 출력본이 달라지므로 절대 분기 금지.

// 발주처(자사) 고정 정보
export const SELF_INFO = {
  companyAndCeo: '(주)아이오피엔 / 이종현',
  businessNumber: '222-81-36621',
  address: '충남 천안시 서북구 성환읍 율금1길 8-15',
  telFax: '041-415-0766 / 041-415-0767',
  email: 'iopn2024@naver.com',
  contact: '손성욱 / 010-7704-0331',
};

export const PO_DEFAULTS = {
  validity: '협의',
  payment: '납품완료후 익월말',
  delivery: '협의',
};

// 발주일 기반 발행번호 접두 — IOPN{YYYYMMDD}
export function poDateStr(purchase) {
  const d = purchase?.orderedAt?.toDate
    ? purchase.orderedAt.toDate()
    : purchase?.orderedAt
      ? new Date(purchase.orderedAt)
      : new Date(purchase?.createdAt?.toDate ? purchase.createdAt.toDate() : new Date());
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `IOPN${yyyy}${mm}${dd}`;
}

// 발주 건 대표 발행번호(파일명·전체출력용) — 발주일 접두만
export function poNumber(purchase) {
  return poDateStr(purchase);
}

// 첫 품목의 defaultSupplierId 자동 추출 — 모두 같은 구매처면 그 값, 혼합/없음이면 빈값
import { resolveEmail, contactsOf, supplierKey } from '../domain/supplierContacts';

export function deriveSupplier(lines, itemMaster, suppliers) {
  const ids = (lines || [])
    .map((ln) => {
      const m = itemMaster.find((x) => x.id === ln.itemId);
      return m?.defaultSupplierId || '';
    })
    .filter(Boolean);
  if (ids.length === 0) return { supplierId: '', supplierName: '' };
  const unique = [...new Set(ids)];
  if (unique.length === 1) {
    const sup = suppliers.find((s) => s.id === unique[0]);
    return { supplierId: unique[0], supplierName: sup?.name || '' };
  }
  return { supplierId: '', supplierName: '' };
}

// 라인을 마스터와 매칭해 출력용 명칭·규격·구매처 부여
export function mapPrintItems(items, itemMaster, suppliers) {
  return (items || []).map((ln, idx) => {
    const mst = itemMaster.find((x) => x.id === ln.itemId);
    const sup = mst ? suppliers.find((s) => s.id === mst.defaultSupplierId) : null;
    return {
      ...ln,
      _globalNo: idx + 1,
      _supplier: sup?.name || '',
      // 같은 업체라도 취급 제품에 따라 받는 사람이 다르다 — 품목에 박아 둔 담당자
      _contact: resolveEmail(sup, mst?.contactEmail),
      _name: mst?.name || ln.name,
      _spec: mst?.spec || ln.spec,
      // 도번은 품목에 적힌 것이 먼저 — 품목에서 고치면 발주서도 따라 바뀐다.
      // 발주 줄에 따로 적힌 값(BOM 에서 온 일회성 도번)이 있으면 그것을 쓴다 (2026-09-02 대표님)
      drawingNo: mst?.drawingNo || ln.drawingNo || '',
    };
  });
}

// 발주 품목을 구매처별로 묶어 [{ name, email, count, orderCount }] 반환 (발행번호 순번·발송 단위 기준)
//
// count      그 업체의 전체 품목 수
// orderCount 그중 실제로 발주할 품목 수 (재고로 채워 수량이 0인 줄은 뺀다)
//
// ★ 발주분이 없는 업체도 목록에서 지우지 않는다 — 발행번호가 이 목록의 순번이라
//   중간을 빼면 뒤 업체들의 발주서 번호가 당겨져, 이미 나간 발주서와 어긋난다.
//   화면에서 감추는 것은 orderCount 로 판단한다.
export function computeSupplierList(items, itemMaster, suppliers, purchase) {
  const fallbackSup = purchase?.supplierId ? suppliers.find((s) => s.id === purchase.supplierId) : null;
  const supMap = new Map();
  for (const ln of items || []) {
    if (!(ln.name || '').trim()) continue;
    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
    const supId = master?.defaultSupplierId || '';
    const sup = (supId ? suppliers.find((s) => s.id === supId) : null) || fallbackSup || null;
    const supName = sup?.name || purchase?.supplierName || '(구매처 미지정)';
    // 담당자가 여럿인 업체는 담당별로 따로 보낸다 (예: COSEL 담당 / 델타 담당)
    const mail = resolveEmail(sup, master?.contactEmail);
    const key = supplierKey(supName, contactsOf(sup).length >= 2 ? mail : '');
    if (!supMap.has(key)) {
      const who = contactsOf(sup).find((c) => c.email === mail);
      supMap.set(key, {
        name: supName,
        email: mail,
        contact: mail,
        contactName: who?.name || '',
        label: who?.name ? `${supName} (${who.name})` : supName,
        count: 0,
        orderCount: 0,
      });
    }
    supMap.get(key).count++;
    if ((Number(ln.qty) || 0) > 0) supMap.get(key).orderCount++;
  }
  return [...supMap.values()];
}
