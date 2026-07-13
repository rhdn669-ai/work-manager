import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from './useDialog';
import Icon from './Icon';
import PasswordChangeModal from './PasswordChangeModal';
import HintSettingModal from './HintSettingModal';
import VehicleMileageModal from './VehicleMileageModal';
import { isPlatformAuthAvailable, hasBioRegistered, registerBio, clearBio } from '../../utils/webauthn';

export default function UserMenu() {
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [bioAvail, setBioAvail] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    (async () => {
      if (await isPlatformAuthAvailable()) setBioAvail(true);
      setBioOn(hasBioRegistered());
    })();
  }, []);

  async function handleBioToggle() {
    if (bioOn) {
      if (!(await confirm({ title: '지문 로그인 해제', message: '이 기기의 지문 로그인을 해제할까요?' }))) return;
      clearBio();
      setBioOn(false);
      setOpen(false);
      toast('지문 로그인이 해제되었습니다.');
      return;
    }
    try {
      await registerBio(userProfile);
      setBioOn(true);
      setOpen(false);
      toast('이 기기에서 지문 로그인이 설정되었습니다.');
    } catch (err) {
      if (err?.name === 'NotAllowedError') toast('지문 등록이 취소되었습니다.', 'error');
      else toast(err?.message || '지문 등록에 실패했습니다.', 'error');
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onEsc(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!userProfile) return null;

  const hasHint = !!userProfile.passwordHintQuestion;

  return (
    <>
      <div className="user-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`user-menu-trigger user-menu-trigger--icon ${open ? 'is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="내 계정 메뉴"
          title={userProfile.name}
        >
          <span className="user-menu-avatar" aria-hidden="true">
            <Icon name="user" size={18} />
            {!hasHint && <span className="user-menu-dot" aria-label="힌트 미설정" />}
          </span>
        </button>
        {open && (
          <div className="user-menu-dropdown" role="menu">
            <div className="user-menu-header">
              <span className="user-menu-header-name">{userProfile.name}</span>
              {userProfile.position && (
                <span className={`badge badge-position-${userProfile.position}`}>{userProfile.position}</span>
              )}
            </div>
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setPwOpen(true);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              비밀번호 변경
            </button>
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setHintOpen(true);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              비밀번호 힌트 {hasHint ? '변경' : '설정'}
              {!hasHint && <span className="user-menu-badge-new">필요</span>}
            </button>
            {bioAvail && (
              <button type="button" className="user-menu-item" role="menuitem" onClick={handleBioToggle}>
                <Icon name="fingerprint" size={15} />
                {bioOn ? '지문 로그인 해제' : '이 기기 지문 등록'}
              </button>
            )}
            {userProfile.usesVehicle && (
              <button
                type="button"
                className="user-menu-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setVehicleOpen(true);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 17h14" />
                  <path d="M5 17a2 2 0 0 1-2-2v-4l2-5h14l2 5v4a2 2 0 0 1-2 2" />
                  <circle cx="7.5" cy="17" r="1.5" />
                  <circle cx="16.5" cy="17" r="1.5" />
                </svg>
                차량 키로수 입력
              </button>
            )}
          </div>
        )}
      </div>
      <PasswordChangeModal isOpen={pwOpen} onClose={() => setPwOpen(false)} />
      <HintSettingModal isOpen={hintOpen} onClose={() => setHintOpen(false)} />
      <VehicleMileageModal isOpen={vehicleOpen} onClose={() => setVehicleOpen(false)} />
    </>
  );
}
