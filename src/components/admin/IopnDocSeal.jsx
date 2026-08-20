// 견적서·발주서·BOM 3종 출력물 공용 하단 발행처 인감란
// 발행 문구 + 발행일 + "주식회사 아이오피엔 대표이사 이종현 (인)" + 빨간 직인 겹침
export default function IopnDocSeal({ statement, date }) {
  return (
    <div className="iopn-seal-block">
      {statement ? <div className="iopn-seal-stmt">{statement}</div> : null}
      {date ? <div className="iopn-seal-date">{date}</div> : null}
      <div className="iopn-seal-issuer">
        <span className="iopn-seal-company">주식회사 아이오피엔</span>
        <span className="iopn-seal-ceo">대표이사 이 종 현</span>
        <span className="iopn-seal-mark">
          {/* 실제 서류처럼 도장이 「(인)」 자리를 대신한다 — 글자는 자리만 잡고 보이지 않는다.
              지우지 않고 남겨 두는 이유: 도장 이미지를 못 불러오면 이 글자가 대신 보여야 한다. */}
          <span className="iopn-seal-txt">(인)</span>
          <img className="iopn-seal-img" src="/company-seal.png" alt="직인" />
        </span>
      </div>
    </div>
  );
}
