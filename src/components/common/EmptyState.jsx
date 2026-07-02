import Icon from './Icon';

/* 통일 빈 화면 — <EmptyState title="..." desc="..." icon="inbox" action={<button.../>} /> */
export default function EmptyState({ icon = 'inbox', title, desc, action }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon name={icon} /></span>
      {title && <div className="empty-state-title">{title}</div>}
      {desc && <div className="empty-state-desc">{desc}</div>}
      {action}
    </div>
  );
}
