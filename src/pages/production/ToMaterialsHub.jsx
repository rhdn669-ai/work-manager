import { Navigate, useLocation, useParams } from 'react-router-dom';

// 옛 자재 주소(/production/:id/materials · /shortage · /paid-sets) → 자재 허브 (북마크 보호, 2026-09-05 안 B 2단계)
export default function ToMaterialsHub({ tab }) {
  const { panelId } = useParams();
  const { search } = useLocation();
  const q = new URLSearchParams(search);
  q.set('tab', tab);
  if (panelId) q.set('panel', panelId);
  return <Navigate to={`/production/materials?${q.toString()}`} replace />;
}
