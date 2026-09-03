import Icon from './Icon';

// 순서 변경·선택 삭제 켜기/끄기 — 앱 공통 토글 (2026-09-03 대표님 「실수로 옮겨버리는 경우가 많아서」).
// 기본은 꺼짐. 켜면 끌기 손잡이와 체크박스가 나타나고, 화면을 나가면 다시 꺼진다(상태는 화면 안에만).
// 삭제가 없는 화면(칸반 등)은 label 을 「순서 변경」으로.
export default function EditModeButton({ on, onToggle, label = '순서·삭제', title, className = '' }) {
  return (
    <button
      type="button"
      className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline'} editmode-btn${on ? ' on' : ''} ${className}`}
      aria-pressed={on}
      onClick={onToggle}
      title={
        title ||
        (on ? '누르면 다시 잠깁니다 — 끌기·선택 삭제 불가' : '누르면 끌어서 순서를 바꾸고 골라서 지울 수 있습니다')
      }
    >
      <Icon name={on ? 'unlock' : 'lock'} className="btn-ic" />
      {label}
    </button>
  );
}
