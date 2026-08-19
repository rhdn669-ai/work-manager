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
          (인)
          <img className="iopn-seal-img" src="/company-seal.png" alt="직인" />
        </span>
      </div>
    </div>
  );
}
