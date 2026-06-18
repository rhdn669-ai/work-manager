import Icon from './Icon';

/* 통일 빈 화면 — <EmptyState title="..." desc="..." icon="inbox" action={<button.../>} /> */
export default function EmptyState({ icon = 'inbox', title, desc, action }) {
  return (
    <div className="empty-state">
      <Icon name={icon} className="empty-state__icon" />
      {title && <div className="empty-state__title">{title}</div>}
      {desc && <div className="empty-state__desc">{desc}</div>}
      {action}
    </div>
  );
}
