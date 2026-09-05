import Icon from './Icon';

// 입고 상태 칩 — 앱 공통 (2026-09-05 대표님 「같은 입고 체크인데 표시가 다르다」).
// 색으로 뜻을 통일한다: 초록=다 들어옴 · 주황=일부 · 회색=아직 · 회색채움=제외.
// 빨강은 「부족」 숫자에만 쓰고 여기서는 쓰지 않는다.
//   got 들어온 개수 · need 필요 개수 · skip 이 호기에서 제외
//   onCancel 을 주면 마우스를 올렸을 때만 오른쪽에 작은 ✕ 이 나타난다(누르면 입고 취소).
//   title 은 날짜·담당자 같은 부연 — 칩에 글자로 넣지 않고 툴팁으로.
export default function ReceiptChip({ got = 0, need = 0, skip = false, title = '', onCancel = null, className = '' }) {
  const g = Number(got) || 0;
  const n = Number(need) || 0;
  const state = skip ? 'skip' : g <= 0 ? 'none' : g >= n ? 'full' : 'partial';
  const label = skip ? '제외' : state === 'none' ? '미입고' : `${g}/${n}`;
  return (
    <span className={`recv-chip is-${state} ${className}`} title={title || undefined}>
      {state === 'full' && <Icon name="check" className="recv-chip-ic" />}
      <span className="recv-chip-n">{label}</span>
      {onCancel && state !== 'none' && !skip && (
        <button
          type="button"
          className="recv-chip-x"
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          title="입고 기록 취소"
          aria-label="입고 기록 취소"
        >
          <Icon name="close" />
        </button>
      )}
    </span>
  );
}
