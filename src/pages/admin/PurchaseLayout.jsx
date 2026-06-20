import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const TABS = [
  { key: 'orders', label: '발주 현황', path: '/admin/purchase' },
  { key: 'bom', label: 'BOM', path: '/admin/purchase/bom' },
  { key: 'items', label: '품목', path: '/admin/purchase/items' },
  { key: 'suppliers', label: '구매처', path: '/admin/purchase/suppliers' },
  { key: 'quotes', label: '견적', path: '/admin/purchase/quotes' },
];

function getActiveTab(pathname) {
  if (/^\/admin\/purchase\/bom(\/|$)/.test(pathname)) return 'bom';
  if (pathname.startsWith('/admin/purchase/items')) return 'items';
  if (pathname.startsWith('/admin/purchase/suppliers')) return 'suppliers';
  if (pathname.startsWith('/admin/purchase/quotes')) return 'quotes';
  return 'orders'; // /admin/purchase, /admin/purchase/:id, /admin/purchase/trash
}

export default function PurchaseLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = getActiveTab(pathname);

  return (
    <>
      <div className="tab-nav hub-tab-nav no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-nav-item ${active === t.key ? 'active' : ''}`}
            onClick={() => navigate(t.path)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Outlet />
    </>
  );
}
