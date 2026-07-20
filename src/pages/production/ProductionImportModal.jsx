import { useRef, useState } from 'react';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import { addPanel } from '../../services/productionService';
import { emptyPanel } from '../../domain/production';
import { fileToBase64, visionOcr, parsePhotoText, OCR_COLUMNS } from '../../domain/productionOcr';

// 엑셀 캡처 사진 → OCR → 편집 표 → 선택 행 일괄 등록
export default function ProductionImportModal({ company, onClose }) {
  const [phase, setPhase] = useState('drop'); // drop | busy | edit | error
  const [rows, setRows] = useState([]);
  const [checked, setChecked] = useState([]);
  const [errMsg, setErrMsg] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setPhase('busy');
    try {
      const b64 = await fileToBase64(file);
      const text = await visionOcr(b64);
      const parsed = parsePhotoText(text);
      if (parsed.length === 0) {
        setErrMsg('프로젝트를 인식하지 못했습니다. 사진 화질/범위를 확인해 주세요.');
        setPhase('error');
        return;
      }
      setRows(parsed);
      setChecked(parsed.map(() => true));
      setPhase('edit');
    } catch (e) {
      setErrMsg(e.message || String(e));
      setPhase('error');
    }
  }

  function setCell(i, key, val) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  }

  async function importChecked() {
    const targets = rows.filter((_, i) => checked[i]);
    for (const r of targets) {
      await addPanel(
        emptyPanel({
          회사: company !== '전체' ? company : '',
          프로젝트: r.프로젝트,
          호기: r.호기,
          정역: r.정역,
          기구제작: r.기구제작,
          자재: r.자재,
          자재입고: r.자재입고,
          납기: r.납기,
          턴온: r.턴온,
          비고: r.납입처 || '',
        }),
      );
    }
    onClose();
  }

  return (
    <Modal isOpen onClose={onClose} title="엑셀 사진 가져오기" size="xl">
      {phase === 'drop' && (
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            setDrag(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <Icon name="image" style={{ width: 36, height: 36 }} />
          <div style={{ fontWeight: 700, marginTop: 8 }}>엑셀 캡처 사진을 놓거나 클릭해서 선택</div>
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)', marginTop: 4 }}>
            사진 속 프로젝트·호기·날짜를 자동 인식합니다
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>
      )}

      {phase === 'busy' && <div className="empty">사진 인식 중…</div>}

      {phase === 'error' && (
        <div className="empty">
          <div style={{ color: 'var(--danger)', fontWeight: 700 }}>인식 실패</div>
          <div style={{ fontSize: 'var(--font-sm)' }}>{errMsg}</div>
          <button className="btn btn-sm btn-outline" onClick={() => setPhase('drop')}>
            다시 시도
          </button>
        </div>
      )}

      {phase === 'edit' && (
        <>
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>
            인식 결과 {rows.length}건 — 값을 수정한 뒤 등록할 행을 선택하세요.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="board-table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  {OCR_COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked[i]}
                        onChange={(e) => setChecked((cs) => cs.map((c, idx) => (idx === i ? e.target.checked : c)))}
                        style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
                      />
                    </td>
                    {OCR_COLUMNS.map((c) => (
                      <td key={c} style={{ padding: '5px 6px' }}>
                        <input
                          value={r[c] || ''}
                          onChange={(e) => setCell(i, c, e.target.value)}
                          style={{
                            width: '100%',
                            height: 30,
                            padding: '0 8px',
                            border: '1.5px solid var(--border)',
                            borderRadius: 8,
                            fontSize: 'var(--font-sm)',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="btn btn-sm btn-outline" onClick={() => setPhase('drop')}>
              다시 선택
            </button>
            <button className="btn btn-primary btn-sm" onClick={importChecked}>
              <Icon name="plus" className="btn-ic" />
              선택 {checked.filter(Boolean).length}건 등록
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
