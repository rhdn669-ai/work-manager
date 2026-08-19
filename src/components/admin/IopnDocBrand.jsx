// 견적서·발주서·BOM 3종 출력물 공용 상단 브랜드 밴드
// 좌: ICNP 엠블럼 + 회사명 / 중앙: 문서 제목 (기존 .print-form-title 대체)
export default function IopnDocBrand({ title, titleClass = '' }) {
  return (
    <div className="iopn-brand-band">
      <div className="iopn-brand-l">
        <img className="iopn-brand-logo" src="/iopn-logo-doc.png" alt="IOPN" />
      </div>
      <div className={`iopn-brand-title ${titleClass}`}>{title}</div>
      <div className="iopn-brand-r" aria-hidden="true" />
    </div>
  );
}
