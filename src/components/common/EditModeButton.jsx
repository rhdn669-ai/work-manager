import Icon from './Icon';

// 「잠금」 — 앱 공통 토글 (2026-09-03 대표님 「실수로 옮겨버리는 경우가 많아서」).
// 기본은 잠김. 풀면 끌기 손잡이·체크박스가 나타나고 칸 수정도 되며, 화면을 나가면 다시 잠긴다(상태는 화면 안에만).
// 이름은 어디서나 「잠금」/「잠금 해제」 하나로 (2026-09-04 대표님 「그냥 버튼 명을 잠금으로 하자」).
export default function EditModeButton({ on, onToggle, label, title, className = '' }) {
  return (
    <button
      type="button"
      className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'} editmode-btn${on ? ' on' : ''} ${className}`}
      aria-pressed={on}
      onClick={onToggle}
      title={
        title ||
        (on
          ? '누르면 다시 잠깁니다 — 칸 수정·끌기·선택 삭제 불가'
          : '누르면 칸을 고치고, 끌어서 순서를 바꾸고, 골라서 지울 수 있습니다')
      }
    >
      <Icon name={on ? 'unlock' : 'lock'} className="btn-ic" />
      {label || (on ? '잠금 해제' : '잠금')}
    </button>
  );
}
