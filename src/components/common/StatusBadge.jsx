export default function StatusBadge({ status, labels }) {
  const label = labels?.[status] || status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}
