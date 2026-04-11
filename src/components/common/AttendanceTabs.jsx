import { NavLink } from 'react-router-dom';

export default function AttendanceTabs() {
  return (
    <div className="tab-nav">
      <NavLink to="/attendance" end className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
        잔업 등록
      </NavLink>
      <NavLink to="/attendance/history" className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
        잔업 이력
      </NavLink>
    </div>
  );
}
