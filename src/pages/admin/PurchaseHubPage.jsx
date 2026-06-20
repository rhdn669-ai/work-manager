import { useSearchParams } from 'react-router-dom';
import PurchaseListPage from './PurchaseListPage';
import BomPage from './BomPage';
import PurchaseItemPage from './PurchaseItemPage';
import SupplierManagementPage from './SupplierManagementPage';
import QuotePage from './QuotePage';

// 구매 허브 — 구매·발주 현황 / BOM / 품목 / 구매처 / 견적을 하나로 묶고 상단 탭으로 전환
const TABS = [
  { key: 'orders', label: '발주 현황', Comp: PurchaseListPage },
  { key: 'bom', label: 'BOM', Comp: BomPage },
  { key: 'items', label: '품목', Comp: PurchaseItemPage },
  { key: 'suppliers', label: '구매처', Comp: SupplierManagementPage },
  { key: 'quotes', label: '견적', Comp: QuotePage },
];

export default function PurchaseHubPage() {
  const [sp, setSp] = useSearchParams();
  const active = TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'orders';
  const Active = TABS.find((t) => t.key === active).Comp;
  return (
    <div className="hub-page">
      <div className="tab-nav hub-tab-nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-nav-item ${active === t.key ? 'active' : ''}`}
            onClick={() => setSp({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Active />
    </div>
  );
}
