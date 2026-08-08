import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../../components/common/Icon';

const TABS = [
  { key: 'orders', label: '발주 현황', path: '/admin/purchase' },
  { key: 'bom', label: 'BOM', path: '/admin/purchase/bom' },
  { key: 'items', label: '품목', path: '/admin/purchase/items' },
  { key: 'stock', label: '재고', path: '/admin/purchase/stock' },
  { key: 'suppliers', label: '구매처', path: '/admin/purchase/suppliers' },
  { key: 'quotes', label: '견적', path: '/admin/purchase/quotes' },
  { key: 'closed', label: '종결', path: '/admin/purchase/closed' },
];

function getActiveTab(pathname) {
  if (/^\/admin\/purchase\/bom(\/|$)/.test(pathname)) return 'bom';
  if (pathname.startsWith('/admin/purchase/items')) return 'items';
  if (pathname.startsWith('/admin/purchase/stock')) return 'stock';
  if (pathname.startsWith('/admin/purchase/suppliers')) return 'suppliers';
  if (pathname.startsWith('/admin/purchase/quotes')) return 'quotes';
  if (pathname.startsWith('/admin/purchase/closed')) return 'closed';
  return 'orders';
}

export default function PurchaseLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = getActiveTab(pathname);

  const [scrollDir, setScrollDir] = useState('down');
  const [showBtn, setShowBtn] = useState(false);

  const check = useCallback(() => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll < 80) {
      setShowBtn(false);
      return;
    }
    setShowBtn(true);
    setScrollDir(window.scrollY / maxScroll >= 0.5 ? 'up' : 'down');
  }, []);

  useEffect(() => {
    window.addEventListener('scroll', check, { passive: true });
    // 콘텐츠 로드 후 높이 재확인
    const t1 = setTimeout(check, 100);
    const t2 = setTimeout(check, 600);
    return () => {
      window.removeEventListener('scroll', check);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pathname, check]);

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
      {showBtn && (
        <button
          type="button"
          className="scroll-jump-btn no-print"
          aria-label={scrollDir === 'up' ? '페이지 상단으로' : '페이지 하단으로'}
          onClick={() => {
            if (scrollDir === 'up') window.scrollTo({ top: 0, behavior: 'smooth' });
            else window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          }}
        >
          <Icon
            name="chevronDown"
            style={{ transform: scrollDir === 'up' ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
          />
        </button>
      )}
    </>
  );
}
