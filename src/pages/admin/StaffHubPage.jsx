import { useSearchParams } from 'react-router-dom';
import UserManagementPage from './UserManagementPage';
import ManageTeamPage from '../manage/ManageTeamPage';
import UnassignedReportPage from './UnassignedReportPage';

// 직원 허브 — 직원 관리 / 팀구성 / 배치현황을 하나로 묶고 상단 탭으로 전환
const TABS = [
  { key: 'staff', label: '직원 관리', Comp: UserManagementPage },
  { key: 'team', label: '팀구성', Comp: ManageTeamPage },
  { key: 'unassigned', label: '배치현황', Comp: UnassignedReportPage },
];

export default function StaffHubPage() {
  const [sp, setSp] = useSearchParams();
  const active = TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'staff';
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
