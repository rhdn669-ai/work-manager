import { useRef, useState } from 'react';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import { updatePanel, uploadDefectPhoto } from '../../services/productionService';
import { BUPMOK, JAIP, MP_SUBS, COMPANIES, TASK_STATES, TASK_CFG, OVERALL_CFG } from '../../domain/production';

const today = () => new Date().toISOString().slice(0, 10);
const mmddDot = (d) => (d ? String(d).slice(5).replace('-', '.') : '');

function getInsp(p) {
  return p.검수 || { 공정작업자: {}, 차1: { 공정비고: {} }, 차2: { 공정비고: {} } };
}

// 판넬 상세/편집 — 변경 즉시 저장. canEdit=false(일반직원)면 조회 전용.
export default function ProductionPanelModal({ panel: p, canEdit, onClose }) {
  const insp = getInsp(p);
  // 불량 사진 촬영/첨부 — 하나의 숨은 input을 공유, 대상(부품·차수·행)을 ref에 보관
  const photoInputRef = useRef(null);
  const photoTargetRef = useRef(null); // { part, round, index|null(null=새 행 추가) }
  const [uploading, setUploading] = useState(false);

  const save = (patch) => {
    if (canEdit) updatePanel(p.id, patch);
  };
  const saveInsp = (mut) => {
    if (!canEdit) return;
    const next = structuredClone(getInsp(p));
    mut(next);
    save({ 검수: next });
  };

  function openCamera(part, round, index = null, kind = '사진') {
    photoTargetRef.current = { part, round, index, kind };
    photoInputRef.current?.click();
  }
  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = photoTargetRef.current;
    if (!file || !target) return;
    setUploading(true);
    try {
      const url = await uploadDefectPhoto(file);
      saveInsp((n) => {
        const { part, round, index } = target;
        if (!n[`차${round}`]) n[`차${round}`] = { 공정비고: {} };
        if (!n[`차${round}`].공정비고) n[`차${round}`].공정비고 = {};
        if (!n[`차${round}`].공정비고[part]) n[`차${round}`].공정비고[part] = { 항목: [] };
        const { kind } = target;
        const sec = n[`차${round}`].공정비고[part];
        if (index == null) sec.항목.push({ 내용: '', 완료: false, 사진: url });
        else sec.항목[index][kind] = url;
      });
    } finally {
      setUploading(false);
    }
  }

  const oc = OVERALL_CFG[p.overallStatus] || OVERALL_CFG['대기중'];

  const field = (label, key, type = 'text') => (
    <div className="pm-field" key={key}>
      <label>{label}</label>
      <input
        type={type}
        defaultValue={p[key] || ''}
        disabled={!canEdit}
        onBlur={(e) => {
          if (e.target.value !== (p[key] || '')) save({ [key]: e.target.value });
        }}
      />
    </div>
  );

  const defectBlock = (part, round) => {
    const sec = insp[`차${round}`]?.공정비고?.[part] || { 항목: [] };
    const items = sec.항목 || [];
    const mutSec = (mut) =>
      saveInsp((n) => {
        if (!n[`차${round}`]) n[`차${round}`] = { 공정비고: {} };
        if (!n[`차${round}`].공정비고) n[`차${round}`].공정비고 = {};
        if (!n[`차${round}`].공정비고[part]) n[`차${round}`].공정비고[part] = { 항목: [] };
        mut(n[`차${round}`].공정비고[part]);
      });
    if (items.length === 0 && (round === 2 || !canEdit)) return null;
    return (
      <div key={round}>
        <div className="defect-round-label">{round}차 불량</div>
        <div className="defect-list">
          {items.map((it, i) => (
            <div className="defect-row" key={i}>
              <input
                type="checkbox"
                checked={!!it.완료}
                disabled={!canEdit}
                onChange={(e) => mutSec((s) => (s.항목[i].완료 = e.target.checked))}
              />
              {it.사진 && (
                <img
                  className="defect-photo"
                  src={it.사진}
                  alt="불량 사진"
                  title="불량 사진"
                  onClick={() => window.open(it.사진, '_blank', 'noopener')}
                />
              )}
              {it.조치사진 && (
                <img
                  className="defect-photo after"
                  src={it.조치사진}
                  alt="조치 사진"
                  title="조치 후 사진"
                  onClick={() => window.open(it.조치사진, '_blank', 'noopener')}
                />
              )}
              <input
                type="text"
                className={it.완료 ? 'done' : ''}
                defaultValue={it.내용 || ''}
                placeholder="불량 내용…"
                disabled={!canEdit}
                onBlur={(e) => {
                  if (e.target.value !== (it.내용 || '')) mutSec((s) => (s.항목[i].내용 = e.target.value));
                }}
              />
              {canEdit && !it.사진 && (
                <button
                  className="defect-cam"
                  onClick={() => openCamera(part, round, i, '사진')}
                  title="불량 사진 촬영"
                >
                  <Icon name="image" />
                </button>
              )}
              {canEdit && it.완료 && !it.조치사진 && (
                <button
                  className="defect-cam after"
                  onClick={() => openCamera(part, round, i, '조치사진')}
                  title="조치 후 사진 촬영"
                >
                  <Icon name="check" />
                </button>
              )}
              {canEdit && (
                <button className="defect-del" onClick={() => mutSec((s) => s.항목.splice(i, 1))} aria-label="삭제">
                  <Icon name="close" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="defect-add-row">
              <button className="defect-add" disabled={uploading} onClick={() => openCamera(part, round, null)}>
                <Icon name="image" className="btn-ic" />{' '}
                {uploading ? '사진 업로드 중…' : `${round}차 불량 추가 (사진 촬영)`}
              </button>
              <button
                className="defect-add-plain"
                onClick={() => mutSec((s) => s.항목.push({ 내용: '', 완료: false }))}
              >
                사진 없이
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal isOpen onClose={onClose} title={`${p.프로젝트 || '판넬'} · ${p.호기 || '호기 미정'}`} size="lg">
      {/* 불량 사진 촬영 — 모바일에서 후면 카메라 바로 열림 */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
      <div style={{ marginBottom: 14 }}>
        <span className="badge" style={{ background: oc.bg, color: oc.fg }}>
          {p.overallStatus}
        </span>
        {!canEdit && (
          <span className="badge" style={{ background: 'var(--grey-100)', color: 'var(--text-muted)', marginLeft: 6 }}>
            조회 전용
          </span>
        )}
      </div>

      <div className="pm-section">
        <div className="pm-section-title">기본정보</div>
        <div className="jaip-row" style={{ marginBottom: 12 }}>
          {COMPANIES.map((c) => {
            const on = p.회사 === c;
            return (
              <button
                key={c}
                className={`jaip-chip ${on ? 'on' : ''}`}
                disabled={!canEdit}
                onClick={() => save({ 회사: on ? '' : c })}
              >
                {on ? '✓ ' : ''}
                {c}
              </button>
            );
          })}
        </div>
        <div className="pm-grid">
          {field('프로젝트', '프로젝트')}
          {field('호기', '호기')}
          {field('정/역', '정역')}
          {field('자재', '자재')}
          {field('기구제작', '기구제작')}
          {field('자재입고일', '자재입고', 'date')}
          {field('납기', '납기', 'date')}
          {field('턴온', '턴온', 'date')}
        </div>
        <div className="pm-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {field('비고', '비고')}
          {field('현장메모', '현장메모')}
        </div>
      </div>

      <div className="pm-section">
        <div className="pm-section-title">자재입고</div>
        <div className="jaip-row">
          {JAIP.map((k) => {
            const on = !!(p.자재입고상태 || {})[k];
            const d = (p.자재입고일자 || {})[k];
            return (
              <button
                key={k}
                className={`jaip-chip ${on ? 'on' : ''}`}
                disabled={!canEdit}
                onClick={() =>
                  save({
                    자재입고상태: { ...(p.자재입고상태 || {}), [k]: !on },
                    자재입고일자: { ...(p.자재입고일자 || {}), [k]: !on ? today() : '' },
                  })
                }
              >
                {on ? '✓ ' : ''}
                {k}
                {on && d ? <small className="chip-date">{mmddDot(d)}</small> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="pm-section">
        <div className="pm-section-title">
          부품 진행 <span className="sub">{canEdit ? '상태 클릭으로 변경 · 작업자/불량 기록' : ''}</span>
        </div>
        {BUPMOK.map((b) => {
          const cur = (p.부품상태 || {})[b] || '대기';
          return (
            <div className="part-card" key={b}>
              <div className="part-head">
                <span className="part-name" style={{ color: TASK_CFG[cur].dot }}>
                  {b}
                </span>
                <div className="state-group">
                  {TASK_STATES.map((s) => (
                    <button
                      key={s}
                      className={`state-btn ${cur === s ? `on-${s}` : ''}`}
                      disabled={!canEdit}
                      onClick={() => save({ 부품상태: { ...(p.부품상태 || {}), [b]: s } })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="worker-input">
                  <span>작업자</span>
                  <input
                    defaultValue={insp.공정작업자?.[b] || ''}
                    placeholder="이름"
                    disabled={!canEdit}
                    onBlur={(e) => {
                      if (e.target.value !== (insp.공정작업자?.[b] || ''))
                        saveInsp((n) => {
                          if (!n.공정작업자) n.공정작업자 = {};
                          n.공정작업자[b] = e.target.value;
                        });
                    }}
                  />
                </div>
              </div>
              {defectBlock(b, 1)}
              {defectBlock(b, 2)}
            </div>
          );
        })}
      </div>

      <div className="pm-section">
        <div className="pm-section-title">
          MP 판넬 <span className="sub">{canEdit ? '클릭 시 대기→진행중→완료→문제 순환' : ''}</span>
        </div>
        <div className="mp-grid">
          {MP_SUBS.map((k) => {
            const cur = (p.mp하위상태 || {})[k] || '대기';
            const next = TASK_STATES[(TASK_STATES.indexOf(cur) + 1) % TASK_STATES.length];
            return (
              <button
                key={k}
                className="mp-item"
                disabled={!canEdit}
                onClick={() => save({ mp하위상태: { ...(p.mp하위상태 || {}), [k]: next } })}
              >
                <b>{k}</b>
                <span className="badge badge-sm" style={{ background: TASK_CFG[cur].bg, color: TASK_CFG[cur].fg }}>
                  <span className="dot" style={{ background: TASK_CFG[cur].dot }} />
                  {cur}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pm-section">
        <div className="pm-section-title">검수 · 출고</div>
        <div className="done-toggles">
          <button
            className={`done-toggle ${p.검수완료 ? 'on' : ''}`}
            disabled={!canEdit}
            onClick={() => save({ 검수완료: !p.검수완료, 검수완료일: !p.검수완료 ? today() : '' })}
          >
            {p.검수완료 ? '✓ ' : ''}검수완료
            {p.검수완료 && p.검수완료일 ? <small className="chip-date">{mmddDot(p.검수완료일)}</small> : null}
          </button>
          <button
            className={`done-toggle ${p.출고완료 ? 'on' : ''}`}
            disabled={!canEdit}
            onClick={() => save({ 출고완료: !p.출고완료, 출고완료일: !p.출고완료 ? today() : '' })}
          >
            {p.출고완료 ? '✓ ' : ''}출고완료
            {p.출고완료 && p.출고완료일 ? <small className="chip-date">{mmddDot(p.출고완료일)}</small> : null}
          </button>
        </div>
      </div>
    </Modal>
  );
}
