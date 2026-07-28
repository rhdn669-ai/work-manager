import { specFontClass } from '../../utils/printText';
import { SELF_INFO } from '../../utils/purchaseOrder';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
import IopnDocSeal from '../../components/admin/IopnDocSeal';

export const DEFAULT_NOTE = '• 견적서 유효기간 : 15일\n• 물품 납품기간 : 일정에 준함\n• 견적서 외 사항은 별도임.';

// 발주서·BOM과 동일한 페이지 분할 규칙 (3종 세로 길이 통일)
const OTHER_PAGE_ROWS = 33; // 일반 페이지(A4를 거의 채우는 행수)
const INFO_ROWS = 11; // 1페이지 상단 로고밴드+정보표가 차지하는 행수
const TOTALS_ROWS = 10; // 마지막 페이지 특이사항+합계+인감이 차지하는 행수
const FIRST_PAGE_ROWS = OTHER_PAGE_ROWS - INFO_ROWS;

function quoteNumber(quote) {
  const d = quote.createdAt?.toDate
    ? quote.createdAt.toDate()
    : quote.createdAt
      ? new Date(quote.createdAt)
      : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const idTail = (quote.id || '').slice(0, 4).toUpperCase();
  return `IOPN-Q${yyyy}${mm}${dd}-${idTail}`;
}

function quoteDateKo(quote) {
  const d = quote.createdAt?.toDate
    ? quote.createdAt.toDate()
    : quote.createdAt
      ? new Date(quote.createdAt)
      : new Date();
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function QuotePrintForm({ quote, hostClass }) {
  const items = (quote.items || []).filter((it) => (it.name || '').trim() || Number(it.qty) || Number(it.unitPrice));
  const supplyAmount =
    Number(quote.totalAmount) || items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const vat = Number(quote.vat) || Math.round(supplyAmount * 0.1);
  const grandTotal = Number(quote.grandTotal) || supplyAmount + vat;
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const supplierTitle = quote.supplierName ? `${quote.supplierName} 귀하` : '';
  const poNum = quoteNumber(quote);

  // 행 개수 기반 페이지 분할 — 페이지를 거의 채우고 하단엔 합계(TOTALS_ROWS)만큼만 공백을 남김.
  const pages = [];
  let i = 0;
  while (i < items.length) {
    const size = pages.length === 0 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
    pages.push({ chunk: items.slice(i, i + size), startNo: i });
    i += size;
  }
  if (pages.length === 0) pages.push({ chunk: [], startNo: 0 });
  // 마지막 페이지에 합계·특이사항이 들어갈 공간이 없으면 빈 페이지를 추가해 합계가 밀리지 않게 함
  const lastCap = pages.length === 1 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
  if (pages[pages.length - 1].chunk.length + TOTALS_ROWS > lastCap) {
    pages.push({ chunk: [], startNo: items.length });
  }
  const pageCount = pages.length;

  return (
    <div className={`print-form-iopn quote-form print-form-paged ${hostClass || ''}`}>
      {pages.map((pg, pageIdx) => {
        const isFirst = pageIdx === 0;
        const isLast = pageIdx === pageCount - 1;
        const cap = isFirst ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
        const targetRows = cap - (isLast ? TOTALS_ROWS : 0);
        const padded = [...pg.chunk];
        while (padded.length < targetRows) padded.push(null);
        return (
          <div className="bom-print-page quote-doc-page" key={pageIdx}>
            {isFirst && <IopnDocBrand title="견 적 서" />}

            {isFirst && (
              <table className="iopn-info-table">
                <tbody>
                  <tr>
                    <th className="lbl">수 신</th>
                    <td className="val">{supplierTitle}</td>
                    <th className="lbl">사업자등록번호</th>
                    <td className="val">{SELF_INFO.businessNumber}</td>
                  </tr>
                  <tr>
                    <th className="lbl">프로젝트</th>
                    <td className="val">{quote.siteName || ''}</td>
                    <th className="lbl">회사명/대표</th>
                    <td className="val">{SELF_INFO.companyAndCeo}</td>
                  </tr>
                  <tr>
                    <th className="lbl">발행번호</th>
                    <td className="val">{poNum}</td>
                    <th className="lbl">주 소</th>
                    <td className="val">{SELF_INFO.address}</td>
                  </tr>
                  <tr>
                    <th className="lbl">유효기간</th>
                    <td className="val">{quote.validity || '15일'}</td>
                    <th className="lbl">TEL/FAX</th>
                    <td className="val">{SELF_INFO.telFax}</td>
                  </tr>
                  <tr>
                    <th className="lbl">납품기일</th>
                    <td className="val">{quote.delivery || '일정에 준함'}</td>
                    <th className="lbl">E-Mail</th>
                    <td className="val">{SELF_INFO.email}</td>
                  </tr>
                  <tr>
                    <th className="lbl">지불조건</th>
                    <td className="val">{quote.payment || '협의'}</td>
                    <th className="lbl">담당/연락처</th>
                    <td className="val">{SELF_INFO.contact}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="iopn-amount-row">
                      금 액 : ₩ {supplyAmount.toLocaleString()}원 / VAT 별도
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            <table className="iopn-items-table quote-cols">
              <thead>
                <tr>
                  <th className="c-no">NO</th>
                  <th className="c-name">품목명</th>
                  <th className="c-spec">규격</th>
                  <th className="c-unit">단위</th>
                  <th className="c-qty">수량</th>
                  <th className="c-price">단가</th>
                  <th className="c-amount">금액</th>
                  <th className="c-note">비고</th>
                </tr>
              </thead>
              <tbody>
                {padded.map((ln, r) => {
                  if (!ln)
                    return (
                      <tr key={`empty-${r}`}>
                        <td className="c-no"></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                        <td></td>
                      </tr>
                    );
                  const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                  return (
                    <tr key={r}>
                      <td className="c-no">{pg.startNo + r + 1}</td>
                      <td className={`c-name ${specFontClass(ln.name, 18)}`} title={ln.name || ''}>
                        {ln.name || ''}
                      </td>
                      <td className={`c-spec ${specFontClass(ln.spec, 20)}`} title={ln.spec || ''}>
                        {ln.spec || ''}
                      </td>
                      <td className="c-unit">{ln.unit || ''}</td>
                      <td className="c-qty">{Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}</td>
                      <td className="c-price">{Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}</td>
                      <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                      <td className={`c-note ${specFontClass(ln.note, 12)}`} title={ln.note || ''}>
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
                      <th className="lbl">특이사항</th>
                      <td className="val">{quote.note || DEFAULT_NOTE}</td>
                    </tr>
                  </tbody>
                </table>

                <table className="iopn-total-table">
                  <tbody>
                    <tr>
                      <th className="lbl">수 량</th>
                      <td className="num">{totalQty.toLocaleString()}</td>
                      <th className="lbl">공급가액</th>
                      <td className="num">{supplyAmount.toLocaleString()}</td>
                      <th className="lbl">VAT</th>
                      <td className="num">{vat.toLocaleString()}</td>
                      <th className="lbl">합 계</th>
                      <td className="num grand">{grandTotal.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>

                <IopnDocSeal statement="위와 같이 견적합니다." date={quoteDateKo(quote)} />
              </>
            )}

            <div className="bom-print-footer">
              <span>(주)아이오피엔 · 견적서 · {poNum}</span>
              <span></span>
              <span>
                페이지 {pageIdx + 1} / {pageCount}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
