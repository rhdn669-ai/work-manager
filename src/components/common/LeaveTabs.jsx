import { NavLink } from 'react-router-dom';

export default function LeaveTabs() {
  return (
    <div className="tab-nav">
      <NavLink to="/leave" end className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
        연차 신청
      </NavLink>
      <NavLink to="/leave/balance" className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
        잔여 현황
      </NavLink>
      <NavLink to="/leave/history" className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
        사용 이력
      </NavLink>
    </div>
  );
}
