// 견적서·발주서·BOM 3종 출력물 공용 상단 브랜드 밴드
// 좌: ICNP 엠블럼 + 회사명 / 중앙: 문서 제목 (기존 .print-form-title 대체)
export default function IopnDocBrand({ title, titleClass = '' }) {
  return (
    <div className="iopn-brand-band">
      <div className="iopn-brand-l">
        <img className="iopn-brand-logo" src="/iopn-logo-doc.png" alt="IOPN" />
      </div>
      <div className={`iopn-brand-title ${titleClass}`}>{title}</div>
      {/* 오른쪽에 로고와 같은 폭의 투명 자리를 두어 제목이 종이 «가운데»에 온다 —
          비워 두면 왼쪽 로고 폭만큼 제목이 오른쪽으로 밀렸다 (2026-09-03 대표님 「제목 위치 틀어짐」) */}
      <div className="iopn-brand-r" aria-hidden="true">
        <img className="iopn-brand-logo iopn-brand-ghost" src="/iopn-logo-doc.png" alt="" />
      </div>
    </div>
  );
}
