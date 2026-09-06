// 호기 이름 — 맨 뒤 세 자리를 강조해 서로 다른 호기를 한눈에 가른다
// (2026-09-05 대표님 「프로젝트 숫자 맨 뒤 3자리 강조 색상」).
// YS-TEPS0926273 → 「YS-TEPS0926」 + 강조 「273」. 숫자로 끝나지 않으면 그대로 둔다.
export default function ProjectName({ name, className = '' }) {
  const s = String(name || '').trim();
  if (!s) return <span className={className}>—</span>;
  const m = s.match(/^(.*?)(\d{3})$/);
  if (!m) return <span className={className}>{s}</span>;
  return (
    <span className={className}>
      {m[1]}
      <b className="proj-tail">{m[2]}</b>
    </span>
  );
}
