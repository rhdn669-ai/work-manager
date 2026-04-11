import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function SiteTabs() {
  const { isAdmin } = useAuth();
  return (
    <div className="tab-nav">
      <NavLink to="/sites" end className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
        마감리스트
      </NavLink>
      {isAdmin && (
        <NavLink to="/admin/sites" className={({ isActive }) => `tab-nav-item ${isActive ? 'active' : ''}`}>
          현장 관리
        </NavLink>
      )}
    </div>
  );
}
