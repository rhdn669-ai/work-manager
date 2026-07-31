import { useState } from 'react';
import Modal from '../common/Modal';
import Icon from '../common/Icon';
import { FORM_FIELDS, computeCalcFields } from '../../domain/qualityFormFields';

// 양식 낱장 — 문서형 서식(성적서·신청서·교육일지)을 A4 종이 그대로 보여주고
// 칸에 바로 입력한다. 조회·편집·인쇄가 한 화면. 인쇄하면 입력칸 테두리가 사라져
// 그냥 서류로 나간다.
//
// 대장형(부적합List 303행 등)은 원본도 데이터 표라 이 화면을 쓰지 않는다.

const VERDICT_CLS = { 합격: 'q-p-pass', 부적합: 'q-p-fail', 보류: 'q-p-hold' };
const VERDICT_KEYS = ['passFailResult', 'overallResult', 'finalResult', 'finalJudgement'];

function Cell({ f, value, onChange, readOnly }) {
  const cls = `q-cell ${f.calc ? 'is-calc' : ''}`;
  if (readOnly || f.calc) return <span className={`${cls} is-static`}>{value || '—'}</span>;
  if (f.type === 'select') {
    return (
      <select className={cls} value={value ?? ''} onChange={(e) => onChange(f.key, e.target.value)}>
        <option value="">선택</option>
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (f.type === 'textarea') {
    return <textarea className={cls} rows={2} value={value ?? ''} onChange={(e) => onChange(f.key, e.target.value)} />;
  }
  return (
    <input
      className={cls}
      type={f.type === 'num' ? 'number' : f.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(f.key, e.target.value)}
    />
  );
}

export default function QualitySheet({ formKey, docNo, record, onSave, onClose, canEdit = true }) {
  const def = FORM_FIELDS[formKey];
  const [draft, setDraft] = useState(record);
  const [editing, setEditing] = useState(!record?.id); // 신규는 바로 편집 상태
  const ro = !editing;

  if (!def) return null;

  const set = (k, v) => setDraft((d) => computeCalcFields(formKey, { ...d, [k]: v }));
  const setLines = (v) => setDraft((d) => computeCalcFields(formKey, { ...d, lines: v }));

  const verdictField = def.fields.find((f) => VERDICT_KEYS.includes(f.key));
  const verdictVal = verdictField ? draft[verdictField.key] : '';
  // 종합판정·계산필드·긴 서술은 본문 아래에서 따로 다룬다
  const gridFields = def.fields.filter(
    (f) => f.type !== 'textarea' && !f.calc && !VERDICT_KEYS.includes(f.key) && !f.group,
  );
  const grouped = def.fields.filter((f) => f.group);
  const narratives = def.fields.filter((f) => f.type === 'textarea');

  const groups = [...new Set(grouped.map((f) => f.group))];

  return (
    <Modal isOpen onClose={onClose} title={`${def.title}`} size="lg">
      <div className="q-print-area">
        <div className={`q-paper ${editing ? 'is-editing' : ''}`}>
          <div className="q-paper-top">{docNo}</div>
          <div className="q-paper-brand">
            <b>IOPN</b>
            <small>주식회사 아이오피엔</small>
          </div>
          <h1 className="q-paper-title">{def.title}</h1>
          <div className="q-paper-rule" />

          {/* 기본정보 — 라벨과 칸이 붙어 있는 2열. 칸이 곧 입력칸 */}
          <div className="q-sheet-grid">
            <div className="q-sheet-row">
              <span className="q-sheet-k">문서번호</span>
              <span className="q-cell is-static">{draft.recordNo}</span>
            </div>
            {gridFields.map((f) => (
              <div key={f.key} className="q-sheet-row">
                <span className="q-sheet-k">{f.label}</span>
                <Cell f={f} value={draft[f.key]} onChange={set} readOnly={ro} />
              </div>
            ))}
          </div>

          {/* 라인아이템 — 검사항목·배점표 */}
          {def.lines && (
            <table className="q-paper-table q-sheet-table">
              <thead>
                <tr>
                  <th style={{ width: '8%' }}>번호</th>
                  {def.lines.columns.map((c) => (
                    <th key={c.key} style={{ width: c.w }}>
                      {c.label}
                    </th>
                  ))}
                  {editing && <th style={{ width: '8%' }} className="q-noprint" />}
                </tr>
              </thead>
              <tbody>
                {(draft.lines || []).map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {def.lines.columns.map((c) => (
                      <td key={c.key}>
                        {c.key === 'result' && (ro || !editing) ? (
                          r[c.key] ? (
                            <span className={`q-p-badge ${VERDICT_CLS[r[c.key]] || ''}`}>{r[c.key]}</span>
                          ) : (
                            '—'
                          )
                        ) : (
                          <Cell
                            f={c}
                            value={r[c.key]}
                            readOnly={ro || c.calc}
                            onChange={(k, v) => {
                              const next = (draft.lines || []).map((row, idx) =>
                                idx === i ? { ...row, [k]: v } : row,
                              );
                              setLines(def.lines.rowCalc ? next.map(def.lines.rowCalc) : next);
                            }}
                          />
                        )}
                      </td>
                    ))}
                    {editing && (
                      <td className="q-noprint">
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => setLines((draft.lines || []).filter((_, idx) => idx !== i))}
                        >
                          <Icon name="trash" className="btn-ic" />
                          삭제
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {!(draft.lines || []).length && (
                  <tr>
                    <td colSpan={def.lines.columns.length + (editing ? 2 : 1)}>등록된 항목 없음</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {def.lines && editing && (
            <button
              type="button"
              className="btn btn-sm btn-outline q-noprint"
              onClick={() => setLines([...(draft.lines || []), {}])}
            >
              <Icon name="plus" className="btn-ic" />
              {def.lines.addLabel}
            </button>
          )}

          {/* 섹션 묶음 (사전검토·검증 등) */}
          {groups.map((g) => (
            <div key={g} className="q-paper-block">
              <div className="q-block-title">{g}</div>
              <div className="q-sheet-grid">
                {grouped
                  .filter((f) => f.group === g)
                  .map((f) => (
                    <div key={f.key} className={`q-sheet-row ${f.type === 'textarea' ? 'is-wide' : ''}`}>
                      <span className="q-sheet-k">{f.label}</span>
                      <Cell f={f} value={draft[f.key]} onChange={set} readOnly={ro} />
                    </div>
                  ))}
              </div>
            </div>
          ))}

          {/* 서술형 */}
          {narratives
            .filter((f) => !f.group)
            .map((f) => (
              <div key={f.key} className="q-paper-block">
                <div className="q-block-title">{f.label}</div>
                <Cell f={f} value={draft[f.key]} onChange={set} readOnly={ro} />
              </div>
            ))}

          {/* 종합판정 */}
          {verdictField && (
            <div className="q-paper-verdict">
              <span>{verdictField.label}</span>
              <div>
                {draft.totalScore != null && draft.grade && (
                  <span className="q-p-total">
                    총점 {draft.totalScore} · 등급 {draft.grade}
                  </span>
                )}
                {ro ? (
                  <span className={`q-p-badge lg ${VERDICT_CLS[verdictVal] || ''}`}>{verdictVal || '—'}</span>
                ) : (
                  <Cell f={verdictField} value={verdictVal} onChange={set} />
                )}
              </div>
            </div>
          )}

          <div className="q-paper-sign">
            {['작성자', '품질팀장'].map((r) => (
              <div key={r} className="q-sign-box">
                <div className="q-sign-label">{r}</div>
                <div className="q-sign-space" />
                <div className="q-sign-foot">
                  <span>성명</span>
                  <span>일자</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-outline" onClick={() => window.print()}>
          인쇄 · PDF
        </button>
        {canEdit &&
          (editing ? (
            <button type="button" className="btn btn-primary" onClick={() => onSave(draft)}>
              저장
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
              수정
            </button>
          ))}
      </div>
    </Modal>
  );
}
