import { specFontClass } from '../../utils/printText';
import { SELF_INFO } from '../../utils/purchaseOrder';

export const DEFAULT_NOTE = '• 견적서 유효기간 : 15일\n• 물품 납품기간 : 일정에 준함\n• 견적서 외 사항은 별도임.';

export const PRINT_ROWS = 15;

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

export default function QuotePrintForm({ quote, hostClass }) {
  const supplyAmount =
    Number(quote.totalAmount) ||
    (quote.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const vat = Number(quote.vat) || Math.round(supplyAmount * 0.1);
  const grandTotal = Number(quote.grandTotal) || supplyAmount + vat;
  const totalQty = (quote.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const printRows = [...(quote.items || [])];
  while (printRows.length < PRINT_ROWS) printRows.push(null);
  const supplierTitle = quote.supplierName ? `${quote.supplierName} 귀하` : '';

  return (
    <div className={`print-form-iopn quote-form ${hostClass || ''}`}>
      <div className="print-form-title">견 적 서</div>
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
            <td className="val">{quoteNumber(quote)}</td>
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
          {printRows.map((ln, idx) => {
            if (!ln)
              return (
                <tr key={`empty-${idx}`}>
                  <td className="c-no">{idx + 1}</td>
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
              <tr key={idx}>
                <td className="c-no">{idx + 1}</td>
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

      <div className="iopn-form-footer">
        <span>(주)아이오피엔 · 견적서 · {quoteNumber(quote)}</span>
        <span>{SELF_INFO.contact}</span>
      </div>
    </div>
  );
}
