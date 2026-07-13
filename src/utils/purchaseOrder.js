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
      _name: mst?.name || ln.name,
      _spec: mst?.spec || ln.spec,
    };
  });
}

// 발주 품목을 구매처별로 묶어 [{ name, email, count }] 반환 (발행번호 순번·발송 단위 기준)
export function computeSupplierList(items, itemMaster, suppliers, purchase) {
  const fallbackSup = purchase?.supplierId ? suppliers.find((s) => s.id === purchase.supplierId) : null;
  const supMap = new Map();
  for (const ln of items || []) {
    if (!(ln.name || '').trim()) continue;
    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
    const supId = master?.defaultSupplierId || '';
    const sup = (supId ? suppliers.find((s) => s.id === supId) : null) || fallbackSup || null;
    const supName = sup?.name || purchase?.supplierName || '(구매처 미지정)';
    if (!supMap.has(supName)) supMap.set(supName, { name: supName, email: sup?.email || '', count: 0 });
    supMap.get(supName).count++;
  }
  return [...supMap.values()];
}
