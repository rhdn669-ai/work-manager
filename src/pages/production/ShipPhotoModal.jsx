import { useRef, useState } from 'react';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import { useDialog } from '../../components/common/useDialog';
import { SHIP_PHOTO_SIDES, boxShipPhotos } from '../../domain/production';
import { uploadShipPhoto, attachShipPhoto } from '../../services/productionService';
import { useUploads } from '../../contexts/useUploads';

const today = () => new Date().toISOString().slice(0, 10);

// 출고사진 — 박스를 내보내기 전 다섯 면을 찍어 남긴다.
// 현장에서 파손 시비가 붙었을 때 나갈 때 상태를 보여 줄 근거가 된다 (2026-08-22 대표님).
export default function ShipPhotoModal({ panel, box, canEdit, checkerName, onClose }) {
  const { toast, confirm } = useDialog();
  const { runUpload } = useUploads();
  const fileRef = useRef(null);
  const targetRef = useRef(null);
  const [busy, setBusy] = useState({}); // { 면: 진행률 }
  const [view, setView] = useState(null); // 크게 보기

  const photos = boxShipPhotos(panel, box);
  const done = SHIP_PHOTO_SIDES.filter((s) => photos[s]).length;

  function pick(side) {
    if (!canEdit) return;
    targetRef.current = side;
    fileRef.current?.click();
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const side = targetRef.current;
    if (!file || !side) return;
    const panelId = panel.id;
    setBusy((m) => ({ ...m, [side]: 0 }));
    // 화면을 닫아도 이어지도록 전역 업로드에 맡긴다 (불량 사진과 같은 방식)
    runUpload(`출고사진 ${box} ${side}`, (onProgress) =>
      uploadShipPhoto(file, (pct) => {
        onProgress(pct);
        setBusy((m) => (side in m ? { ...m, [side]: pct } : m));
      }),
    )
      .then((url) => attachShipPhoto(panelId, { box, side, url, by: checkerName, today: today() }))
      .catch(() => toast('사진 업로드에 실패했습니다. 다시 시도해 주세요.', 'error', 0))
      .finally(() =>
        setBusy((m) => {
          const n = { ...m };
          delete n[side];
          return n;
        }),
      );
  }

  async function remove(side) {
    if (!canEdit) return;
    if (!(await confirm(`${box} ${side} 사진을 지울까요?`))) return;
    try {
      await attachShipPhoto(panel.id, { box, side, url: '', by: checkerName, today: today() });
    } catch {
      toast('사진을 지우지 못했습니다', 'error');
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`출고사진 — ${box}`} size="lg">
      <p className="field-hint" style={{ marginTop: 0 }}>
        내보내기 전 다섯 면을 찍어 남깁니다. 지금 <strong>{done}/5</strong> 장 등록되어 있습니다.
      </p>
      <div className="ship-photo-grid">
        {SHIP_PHOTO_SIDES.map((side) => {
          const url = photos[side];
          const info = photos[`${side}_정보`];
          const pct = busy[side];
          return (
            <div className={`ship-photo-slot${url ? ' has-photo' : ''}`} key={side}>
              <div className="ship-photo-head">
                <strong>{side}</strong>
                {url && canEdit && (
                  <button type="button" className="ship-photo-del" onClick={() => remove(side)} aria-label="사진 삭제">
                    <Icon name="trash" />
                  </button>
                )}
              </div>
              {pct != null ? (
                <div className="ship-photo-box is-busy">올리는 중 {pct}%</div>
              ) : url ? (
                <button type="button" className="ship-photo-box" onClick={() => setView({ url, side })}>
                  <img src={url} alt={`${box} ${side}`} loading="lazy" />
                </button>
              ) : (
                <button
                  type="button"
                  className="ship-photo-box is-empty"
                  disabled={!canEdit}
                  onClick={() => pick(side)}
                >
                  <Icon name="image" />
                  <span>{canEdit ? '사진 촬영·선택' : '사진 없음'}</span>
                </button>
              )}
              <div className="ship-photo-foot">{url ? `${info?.by || ''}${info?.at ? ` · ${info.at}` : ''}` : ''}</div>
              {url && canEdit && (
                <button type="button" className="ship-photo-again" onClick={() => pick(side)}>
                  다시 찍기
                </button>
              )}
            </div>
          );
        })}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={onFile}
      />
      {view && (
        <Modal isOpen onClose={() => setView(null)} title={`${box} · ${view.side}`} size="lg">
          <img src={view.url} alt={view.side} style={{ width: '100%', borderRadius: 'var(--radius-sm)' }} />
        </Modal>
      )}
    </Modal>
  );
}
