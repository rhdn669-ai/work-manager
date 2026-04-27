import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import PasswordChangeModal from './PasswordChangeModal';
import HintSettingModal from './HintSettingModal';

export default function UserMenu() {
  const { userProfile, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!userProfile) return null;

  const initial = (userProfile.name || '?').trim().charAt(0);
  const hasHint = !!userProfile.passwordHintQuestion;

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <>
      <div className="user-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`user-menu-trigger ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="user-menu-avatar" aria-hidden="true">
            {initial}
            {!hasHint && <span className="user-menu-dot" aria-label="힌트 미설정" />}
          </span>
          <span className="user-menu-name">
            {userProfile.name}
            {userProfile.position && (
              <> (<span className={`badge badge-position-${userProfile.position}`}>{userProfile.position}</span>)</>
            )}
          </span>
          <svg className="user-menu-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {open && (
          <div className="user-menu-dropdown" role="menu">
            <button type="button" className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); setPwOpen(true); }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              비밀번호 변경
            </button>
            <button type="button" className="user-menu-item" role="menuitem" onClick={() => { setOpen(false); setHintOpen(true); }}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              비밀번호 힌트 {hasHint ? '변경' : '설정'}
              {!hasHint && <span className="user-menu-badge-new">필요</span>}
            </button>
            <button type="button" className="user-menu-item user-menu-item-danger" role="menuitem" onClick={handleLogout}>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              로그아웃
            </button>
          </div>
        )}
      </div>
      <PasswordChangeModal isOpen={pwOpen} onClose={() => setPwOpen(false)} />
      <HintSettingModal isOpen={hintOpen} onClose={() => setHintOpen(false)} />
    </>
  );
}
