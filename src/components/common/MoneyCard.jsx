// 돈 카드 — 공급가와 VAT 포함을 한 장 안에 나란히 세운다.
//
// 카드마다 큰 숫자가 하나뿐이었다. 어떤 카드는 공급가, 어떤 카드는 VAT 포함이라
// 카드 이름을 읽어야 무슨 값인지 알 수 있었다. 이제 모든 카드가 같은 두 줄을 가진다 —
// 「공급가 / VAT 포함」. 카드 이름은 「무엇의 돈인지」만 말한다
// (2026-08-27 대표님 「공급가 부가세포함가로 나눠줘 · 한눈에 구분하기 편하게」).
//
// 넘기는 값은 공급가 하나다. VAT 는 여기서 계산한다 — 두 화면이 다른 식을 쓰면 숫자가 갈린다.

const won = (n) => (Number(n) || 0).toLocaleString();
const withVat = (n) => {
  const v = Number(n) || 0;
  return v + Math.round(v * 0.1);
};

/**
 * @param {string} label  카드 이름 (결제 대기 · 결제 완료 · 합계 · 지출 …)
 * @param {string} note   이름 옆 작은 설명
 * @param {number} supply 공급가. VAT 포함은 여기서 계산한다.
 * @param {string} tone   'wait' | 'good' | '' — 색으로도 갈라 준다
 * @param {ReactNode} sub 카드 아래 보조 줄
 * @param {boolean} hidden 탭에 안 맞는 카드는 숨긴다
 */
export default function MoneyCard({ label, note, supply, tone = '', sub, hidden = false }) {
  return (
    <div className={`sum-card money-card${tone ? ` is-${tone}` : ''}`} hidden={hidden}>
      <div className="sum-card-label">
        {label}
        {note && <span className="sum-card-note">{note}</span>}
      </div>
      <div className="money-line">
        <span className="money-tag">공급가</span>
        <span className="money-num">
          {won(supply)}
          <em>원</em>
        </span>
      </div>
      <div className="money-line is-vat">
        <span className="money-tag">VAT 포함</span>
        <span className="money-num">
          {won(withVat(supply))}
          <em>원</em>
        </span>
      </div>
      {sub && <div className="sum-card-sub">{sub}</div>}
    </div>
  );
}
