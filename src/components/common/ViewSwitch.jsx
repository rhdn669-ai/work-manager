// 「보기 전환」 세그먼트 — 앱 공통 (2026-09-05 대표님 UI 기준안 승인).
// 현황/불량현황/통계 · 보드/목록 · 표/카드 · 업체별/프로젝트별 · 재직/퇴사 처럼
// «같은 데이터를 다른 방식으로 보는» 전환은 전부 이 하나로. 생산현황의 알약(pr-views) 모양이 기준.
// 켜고 끄는 «필터»(긴급 D-7·출고 숨김)는 이게 아니라 .filter-chip 을 쓴다.
//   options: [{ value, label, count? }]  value: 현재 값  onChange(value)
//   size: 'sm'(높이 30, 기본) | 'md'(높이 36 — 페이지 머리 버튼과 나란히 둘 때)
export default function ViewSwitch({ options, value, onChange, ariaLabel = '보기', size = 'sm', className = '' }) {
  return (
    <div className={`view-switch view-switch--${size} ${className}`} role="tablist" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={`view-switch-item${value === o.value ? ' on' : ''}`}
          onClick={() => value !== o.value && onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count !== null && <span className="view-switch-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
