import { forwardRef } from 'react';
import { specFontClass } from '../../utils/printText';
import { useCompanyInfo } from '../../contexts/useCompanyInfo';
import IopnDocBrand from './IopnDocBrand';
import IopnDocSeal from './IopnDocSeal';
import { PO_DEFAULTS, poDateStr, deriveSupplier, mapPrintItems, computeSupplierList } from '../../utils/purchaseOrder';

// 인쇄 전용 IOPN 구매발주서 양식 (PDF 캡처 대상).
// PurchaseDetailPage(실시간 출력·메일)와 저장본 일괄 재생성 도구가 공유한다.
// ▸ props 로 받은 값만으로 렌더 — 내부 상태 없음(순수). 양식이 갈라지지 않도록 단일 출처.
//   purchase, form(items/note/supplierNotes/deliveryPlace), suppliers, sites, itemMaster
//   printSupplierFilter : 특정 업체만 출력(null=전체)
//   printAccountMode    : true면 특이사항 아래 구매처 계좌 표시(내부용)
//   printSiteNameMode   : null=실제 현장명 / 'blank'=공백 / 그 외=미공개(외부용)
const PurchaseOrderPrintForm = forwardRef(function PurchaseOrderPrintForm(
  {
    purchase,
    form,
    suppliers = [],
    sites = [],
    itemMaster = [],
    printSupplierFilter = null,
    printContactFilter = null, // 같은 업체라도 담당자별로 갈라 보낼 때
    printAccountMode = false,
    printSiteNameMode = null,
    hideAmount = false,
    showBox = false, // BOX 열 표시 — 「PDF 출력」(전체) 옵션에서만 켬. 업체별·메일·자료실 저장엔 미표시
  },
  ref,
) {
  const { info: SELF_INFO } = useCompanyInfo();
  if (!purchase || !form) return <div ref={ref} className="print-form-iopn print-form-paged print-only" />;

  const supplier = suppliers.find((s) => s.id === purchase.supplierId);
  const site = sites.find((s) => s.id === purchase.siteId);
  const derivedSupplier = purchase.supplierName || deriveSupplier(form.items, itemMaster, suppliers).supplierName;
  const liveOrderDate = purchase.orderedAt?.toDate
    ? purchase.orderedAt.toDate()
    : purchase.orderedAt
      ? new Date(purchase.orderedAt)
      : purchase.createdAt?.toDate
        ? purchase.createdAt.toDate()
        : new Date();
  const liveOrderDateKo = `${liveOrderDate.getFullYear()}년 ${liveOrderDate.getMonth() + 1}월 ${liveOrderDate.getDate()}일`;
  const liveSupplierTitle = supplier?.name ? `${supplier.name} 귀하` : derivedSupplier ? `${derivedSupplier} 귀하` : '';

  const src = {
    siteName: site?.name || purchase.siteName || '',
    deliveryPlace: form.deliveryPlace || purchase.deliveryPlace || SELF_INFO.address,
    deliveryDue: purchase.deliveryDue || PO_DEFAULTS.delivery,
    payment: purchase.payment || PO_DEFAULTS.payment,
    contactLine: [purchase.contactName || purchase.requesterName || '', purchase.contactPhone || '']
      .filter(Boolean)
      .join(' / '),
    // 업체별 출력이면 그 업체 특이사항 우선, 없으면 발주 전체 메모
    note: (() => {
      if (printSupplierFilter) {
        const key = printSupplierFilter.replace(/\./g, '_');
        const supNote = form.supplierNotes?.[key];
        if (supNote && supNote.trim()) return supNote;
      }
      return form.note || '';
    })(),
    orderDateKo: liveOrderDateKo,
    // 업체별 출력이면 그 업체의 발행번호(발주일+구매처순번+발주건 고유ID), 전체 출력이면 발주일+ID
    poNum: (() => {
      const idTail = (purchase.id || '').slice(0, 4).toUpperCase();
      if (!printSupplierFilter) return `${poDateStr(purchase)}-${idTail}`;
      const sl = computeSupplierList(form.items, itemMaster, suppliers, purchase);
      const i = sl.findIndex((s) => s.name === printSupplierFilter);
      return i >= 0 ? `${poDateStr(purchase)}-${i + 1}-${idTail}` : `${poDateStr(purchase)}-${idTail}`;
    })(),
    supplierTitle: printSupplierFilter ? `${printSupplierFilter} 귀하` : liveSupplierTitle,
    supplierLabel: printSupplierFilter || '',
    // 내부 저장용 PDF의 구매처 계좌정보 (printAccountMode일 때만 행 표시).
    // 계좌 정보가 없어도 "입금계좌" 행은 고정으로 노출하고 값만 공백으로 둔다.
    //   null  = 행 자체 미표시(외부 메일 첨부본)
    //   ''    = 행은 표시하되 값 공백(내부용·계좌 미등록)
    account: (() => {
      if (!printAccountMode) return null;
      const sup = printSupplierFilter
        ? suppliers.find((s) => s.name === printSupplierFilter)
        : suppliers.find((s) => s.id === purchase.supplierId);
      if (!sup || (!sup.bankName && !sup.bankAccount)) return '';
      const holder = sup.representative || sup.name || '';
      return `${sup.bankName || ''} ${sup.bankAccount || ''}${holder ? ` (${holder})` : ''}`.trim();
    })(),
    // 특정 업체 출력이면 그 업체 품목만
    items: mapPrintItems(form.items, itemMaster, suppliers).filter(
      (ln) =>
        (!printSupplierFilter || (ln._supplier || '(구매처 미지정)') === printSupplierFilter) &&
        (printContactFilter == null || (ln._contact || '') === printContactFilter),
    ),
  };

  // 항상 1장 (특정 업체 또는 전체)
  const docs = [
    {
      recvTitle: src.supplierTitle,
      supplierLabel: src.supplierLabel || '',
      // 재고로 채워 발주 수량이 0인 줄은 싣지 않는다 — 업체는 실제 발주분만 받는다
      items: src.items.filter((ln) => (ln._name || ln.name || '').trim() && (Number(ln.qty) || 0) > 0),
    },
  ];

  // 행 개수 기반 페이지 분할 — 페이지를 거의 채우고 하단엔 합계·특이사항 크기(TOTALS_ROWS)만큼만 공백을 남김.
  const OTHER_PAGE_ROWS = 33; // 일반 페이지(페이지를 거의 채우는 행수)
  const INFO_ROWS = 11; // 1페이지 상단 제목+정보표가 차지하는 행수
  const TOTALS_ROWS = 10; // 마지막 페이지 합계+특이사항+인감이 차지하는 행수(= 모든 페이지 하단 공백 크기)
  const FIRST_PAGE_ROWS = OTHER_PAGE_ROWS - INFO_ROWS;

  // 품번(_globalNo)은 전체 발주 기준 번호 — 업체별 출력에서만 의미 있음 (전체 출력은 NO와 중복이라 숨김)
  const showItemNo = !!printSupplierFilter;

  // 한 문서(구매처)를 페이지 div 배열로 렌더
  const renderDoc = (rows, recvTitle, supplierLabel, docKey) => {
    const supplyAmount = rows.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0);
    const totalQty = rows.reduce((s, ln) => s + (Number(ln.qty) || 0), 0);
    const vat = Math.round(supplyAmount * 0.1);
    const grandTotal = supplyAmount + vat;
    // 행 개수로 페이지 분할
    const pages = [];
    let i = 0;
    while (i < rows.length) {
      const size = pages.length === 0 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
      pages.push({ chunk: rows.slice(i, i + size), startNo: i });
      i += size;
    }
    if (pages.length === 0) pages.push({ chunk: [], startNo: 0 });
    // 마지막 페이지에 합계·특이사항(TOTALS_ROWS)이 들어갈 공간이 없으면 빈 페이지를 추가해 합계가 밀리지 않게 함
    const lastCap = pages.length === 1 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
    if (pages[pages.length - 1].chunk.length + TOTALS_ROWS > lastCap) {
      pages.push({ chunk: [], startNo: rows.length });
    }
    const pageCount = pages.length;

    return pages.map((pg, pageIdx) => {
      const isFirst = pageIdx === 0;
      const isLast = pageIdx === pageCount - 1;
      const cap = isFirst ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
      const targetRows = cap - (isLast ? TOTALS_ROWS : 0);
      const padded = [...pg.chunk];
      while (padded.length < targetRows) padded.push(null);
      return (
        <div className="bom-print-page po-doc-page" key={`${docKey}-${pageIdx}`}>
          {isFirst && <IopnDocBrand title="구매발주서" titleClass="po-form-title" />}

          {isFirst && (
            <table className="iopn-info-table">
              <tbody>
                <tr>
                  <th scope="col" className="lbl">
                    수 신
                  </th>
                  <td className="val">{recvTitle}</td>
                  <th scope="col" className="lbl">
                    사업자등록번호
                  </th>
                  <td className="val">{SELF_INFO.businessNumber}</td>
                </tr>
                <tr>
                  <th scope="col" className="lbl">
                    프로젝트
                  </th>
                  <td className="val">
                    {printSiteNameMode ? (printSiteNameMode === 'blank' ? ' ' : '미공개') : src.siteName}
                  </td>
                  <th scope="col" className="lbl">
                    회사명/대표
                  </th>
                  <td className="val">{SELF_INFO.companyAndCeo}</td>
                </tr>
                <tr>
                  <th scope="col" className="lbl">
                    납품장소
                  </th>
                  <td className="val">{src.deliveryPlace}</td>
                  <th scope="col" className="lbl">
                    주 소
                  </th>
                  <td className="val">{SELF_INFO.address}</td>
                </tr>
                <tr>
                  <th scope="col" className="lbl">
                    발행번호
                  </th>
                  <td className="val">{src.poNum}</td>
                  <th scope="col" className="lbl">
                    TEL/FAX
                  </th>
                  <td className="val">{SELF_INFO.telFax}</td>
                </tr>
                <tr>
                  <th scope="col" className="lbl">
                    발 주 일
                  </th>
                  <td className="val">{src.orderDateKo}</td>
                  <th scope="col" className="lbl">
                    납품기일
                  </th>
                  <td className="val">{src.deliveryDue}</td>
                </tr>
                <tr>
                  <th scope="col" className="lbl">
                    지불조건
                  </th>
                  <td className="val">{src.payment}</td>
                  <th scope="col" className="lbl">
                    담당/연락처
                  </th>
                  <td className="val">{src.contactLine}</td>
                </tr>
                {!hideAmount && (
                  <tr>
                    <td colSpan={4} className="iopn-amount-row">
                      총 금액(VAT 포함) : ₩ {grandTotal.toLocaleString()}원
                      <span className="iopn-amount-sub">
                        {' '}
                        (공급가액 {supplyAmount.toLocaleString()} + VAT {vat.toLocaleString()})
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          <table className={`iopn-items-table po-cols${showBox ? ' has-box' : ''}${showItemNo ? '' : ' no-itemno'}`}>
            <thead>
              <tr>
                <th scope="col" className="c-no">
                  NO
                </th>
                {showItemNo && (
                  <th scope="col" className="c-itemno">
                    품번
                  </th>
                )}
                {showBox && (
                  <th scope="col" className="c-box">
                    BOX
                  </th>
                )}
                <th scope="col" className="c-name">
                  품목명
                </th>
                <th scope="col" className="c-spec">
                  규격
                </th>
                <th scope="col" className="c-qty">
                  수량
                </th>
                <th scope="col" className="c-price">
                  단가
                </th>
                <th scope="col" className="c-amount">
                  금액
                </th>
                <th scope="col" className="c-recv">
                  입고
                </th>
                <th scope="col" className="c-note">
                  비고
                </th>
              </tr>
            </thead>
            <tbody>
              {padded.map((ln, r) => {
                if (!ln)
                  return (
                    <tr key={`e-${r}`}>
                      <td className="c-no"></td>
                      {showItemNo && <td className="c-itemno"></td>}
                      {showBox && <td className="c-box"></td>}
                      <td className="c-name"></td>
                      <td className="c-spec"></td>
                      <td className="c-qty"></td>
                      <td className="c-price"></td>
                      <td className="c-amount"></td>
                      <td className="c-recv"></td>
                      <td className="c-note"></td>
                    </tr>
                  );
                const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                const q = Number(ln.qty) || 0;
                const rq = Number(ln.receivedQty) || 0;
                const recvText = q <= 0 ? '' : rq >= q ? '완료' : rq > 0 ? `${rq}/${q}` : '미입고';
                return (
                  <tr key={r}>
                    <td className="c-no">{pg.startNo + r + 1}</td>
                    {showItemNo && <td className="c-itemno">{ln._globalNo || ''}</td>}
                    {showBox && (
                      <td className="c-box" title={ln.box || ''}>
                        {ln.box || ''}
                      </td>
                    )}
                    <td className="c-name" title={ln._name || ''}>
                      {ln._name || ''}
                    </td>
                    <td className="c-spec" title={ln._spec || ''}>
                      {ln._spec || ''}
                    </td>
                    <td className="c-qty">{Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}</td>
                    <td className="c-price">{Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}</td>
                    <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                    <td className={`c-recv ${rq >= q && q > 0 ? 'recv-done' : rq === 0 ? 'recv-none' : ''}`}>
                      {recvText}
                    </td>
                    <td className={`c-note ${specFontClass(ln.note, 11)}`} title={ln.note || ''}>
                      {ln.note || ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {isLast && (
            <>
              <table className="iopn-notes-table">
                <tbody>
                  <tr>
                    <th scope="col" className="lbl">
                      특이사항
                    </th>
                    <td className="val">{src.note || ''}</td>
                  </tr>
                  {src.account !== null && (
                    <tr>
                      <th scope="col" className="lbl">
                        입금계좌
                      </th>
                      <td className="val">{src.account || ''}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <table className="iopn-total-table">
                <tbody>
                  <tr>
                    <th scope="col" className="lbl">
                      수량
                    </th>
                    <td className="num">{totalQty.toLocaleString()}</td>
                    {!hideAmount && (
                      <>
                        <th scope="col" className="lbl">
                          공급가액
                        </th>
                        <td className="num">{supplyAmount.toLocaleString()}</td>
                        <th scope="col" className="lbl">
                          VAT
                        </th>
                        <td className="num">{vat.toLocaleString()}</td>
                        <th scope="col" className="lbl">
                          합계
                        </th>
                        <td className="num grand">{grandTotal.toLocaleString()}</td>
                      </>
                    )}
                  </tr>
                </tbody>
              </table>

              <IopnDocSeal statement="위와 같이 발주합니다." date={src.orderDateKo} />
            </>
          )}

          <div className="bom-print-footer">
            <span>
              구매발주서{supplierLabel ? ` · ${supplierLabel}` : ''} · {src.poNum}
            </span>
            {/* 출력 시각은 넣지 않는다 — 같은 내용인데도 파일이 매번 달라져
                미리 만들어 둔 발주서를 다시 쓸 수 없게 된다 (2026-08-20 대표님) */}
            <span />
            <span>
              페이지 {pageIdx + 1} / {pageCount}
            </span>
          </div>
        </div>
      );
    });
  };

  return (
    <div ref={ref} className={`print-form-iopn print-form-paged print-only${hideAmount ? ' hide-amount' : ''}`}>
      {docs.map((d, di) => renderDoc(d.items, d.recvTitle, d.supplierLabel, `doc${di}`))}
    </div>
  );
});

export default PurchaseOrderPrintForm;
