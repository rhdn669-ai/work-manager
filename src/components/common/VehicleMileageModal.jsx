import { useEffect, useState } from 'react';
import Modal from './Modal';
import { useAuth } from '../../contexts/AuthContext';
import {
  getMileage, getLatestPrevMileage, saveMileage,
} from '../../services/vehicleMileageService';

// 차량 운행 키로수 입력 모달
// - 자동 경고 모드: Layout이 매 로그인마다 이번달 미입력일 때 자동 노출
// - 수동 모드: UserMenu에서 "차량 키로수 입력" 클릭으로도 열림
// 입력 후 저장하면 닫히고, 닫기만 누르면 다음 로그인에 다시 노출됨

function fmtNumber(n) {
  if (n == null || isNaN(Number(n))) return '-';
  return Number(n).toLocaleString();
}

export default function VehicleMileageModal({ isOpen, onClose, onSaved }) {
  const { userProfile } = useAuth();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const ymLabel = `${year}년 ${String(month).padStart(2, '0')}월`;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState(null);
  const [prev, setPrev] = useState(null);
  const [odometer, setOdometer] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !userProfile?.uid) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setOdometer('');
    setExisting(null);
    setPrev(null);
    (async () => {
      try {
        const [cur, prevRec] = await Promise.all([
          getMileage(userProfile.uid, year, month),
          getLatestPrevMileage(userProfile.uid, year, month),
        ]);
        if (cancelled) return;
        setExisting(cur);
        setPrev(prevRec);
        if (cur) setOdometer(String(cur.odometer || ''));
      } catch (err) {
        if (!cancelled) setError('데이터 조회 실패: ' + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, userProfile?.uid, year, month]);

  const odometerNum = Number(String(odometer).replace(/[^\d.]/g, '')) || 0;
  const prevOdometer = Number(prev?.odometer) || 0;
  const drivenKm = odometerNum >= prevOdometer ? odometerNum - prevOdometer : 0;
  const isInvalid = odometerNum > 0 && prevOdometer > 0 && odometerNum < prevOdometer;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!userProfile?.uid) return;
    if (!odometerNum || odometerNum <= 0) {
      setError('현재 누적 키로수를 입력해주세요.');
      return;
    }
    if (isInvalid) {
      setError('현재 누적값은 이전월(' + fmtNumber(prevOdometer) + ' km) 이상이어야 합니다.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await saveMileage(userProfile.uid, year, month, {
        userName: userProfile.name || '',
        plate: userProfile.vehiclePlate || '',
        odometer: odometerNum,
        prevOdometer,
      });
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError('저장 실패: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`차량 운행 키로수 — ${ymLabel}`}>
      <div className="vehicle-mileage-modal">
        <div className="vehicle-mileage-greet">
          <strong>{userProfile?.name}</strong>님,
          {existing
            ? <> 이번달 누적 키로수가 등록되어 있습니다. 필요 시 수정할 수 있어요.</>
            : <> 이번달 누적 키로수를 입력해 주세요.</>}
        </div>

        <div className="vehicle-mileage-info">
          <div className="vmm-row">
            <span className="vmm-label">차량번호</span>
            <span className="vmm-value">{userProfile?.vehiclePlate || <span className="text-muted">미등록</span>}</span>
          </div>
          <div className="vmm-row">
            <span className="vmm-label">이전월 누적</span>
            <span className="vmm-value">
              {prev
                ? <><strong>{fmtNumber(prev.odometer)}</strong> km <span className="text-muted text-sm">({prev.yearMonth})</span></>
                : <span className="text-muted">기록 없음 (이번이 첫 입력)</span>}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="vmm-odometer">현재 누적 키로수 (km)</label>
            <input
              id="vmm-odometer"
              type="text"
              inputMode="numeric"
              value={odometer}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                setOdometer(raw ? Number(raw).toLocaleString() : '');
                setError('');
              }}
              placeholder="예: 45,200"
              autoFocus
              disabled={loading || saving}
            />
            {odometerNum > 0 && (
              <div className={`vmm-driven ${isInvalid ? 'is-invalid' : ''}`}>
                {isInvalid
                  ? <>⚠ 이전월보다 작습니다 — 다시 확인해 주세요</>
                  : <>이번달 운행 거리: <strong>{fmtNumber(drivenKm)}</strong> km</>}
              </div>
            )}
          </div>

          {error && <div className="vmm-error">{error}</div>}

          <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={saving}
            >
              {existing ? '닫기' : '다음에'}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || saving || !odometerNum || isInvalid}
            >
              {saving ? '저장 중…' : (existing ? '수정' : '등록')}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
