import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import Modal from '../common/Modal';
import TrashModal from '../common/TrashModal';
import { useDialog } from '../common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { VERDICT } from '../../domain/qualityForms';
import { FORM_FIELDS, computeCalcFields } from '../../domain/qualityFormFields';
import { subscribeRecords, addRecord, updateRecord, trashRecord } from '../../services/qualityRecordService';
import QualityDocPrint from './QualityDocPrint';
import QualitySheet from './QualitySheet';

// 양식 엔진 — 서식 정의(FORM_FIELDS)만 바꿔 10종 대장이 이 컴포넌트 하나를 공유한다.
// 화면 골격은 스티치 「대장 목록 공통 골격」을 따른다:
// 헤더(서식명+문서번호 / 우측 휴지통·신규) → 필터바 → 표(판정 배지 + 우측 작업) → 하단 집계

// 판정 성격의 필드를 찾아 배지로 렌더 — 서식마다 이름이 다르다(합불/종합/최종/전체)
const VERDICT_KEYS = ['passFailResult', 'overallResult', 'finalResult', 'finalJudgement'];
const verdictOf = (row) => {
  const raw = VERDICT_KEYS.map((k) => row[k]).find(Boolean);
  return Object.values(VERDICT).find((v) => v.label === raw) || null;
};

function Field({ f, value, onChange }) {
  const common = { value: value ?? '', onChange: (e) => onChange(f.key, e.target.value) };
  return (
    <div className={`form-group ${f.type === 'textarea' ? 'form-full' : ''}`}>
      <label>
        {f.label}
        {f.required && ' *'}
      </label>
      {f.calc ? (
        <input value={value ?? ''} readOnly className="q-calc-input" />
      ) : f.type === 'textarea' ? (
        <textarea rows={2} {...common} />
      ) : f.type === 'select' ? (
        <select {...common}>
          <option value="">선택</option>
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input type={f.type === 'num' ? 'number' : f.type === 'date' ? 'date' : 'text'} {...common} />
      )}
    </div>
  );
}

// 라인아이템 표 (성적서 검사항목 · 평가시트 배점) — 행마다 수식이 즉시 돈다
function LineItems({ cfg, lines, onChange }) {
  const rows = lines || [];
  const patch = (i, k, v) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r));
    onChange(cfg.rowCalc ? next.map(cfg.rowCalc) : next);
  };
  return (
    <div className="form-full q-form-group">
      <div className="q-form-group-title">{cfg.title}</div>
      <div className="table-scroll-x">
        <table className="table q-line-table">
          <thead>
            <tr>
              {cfg.columns.map((c) => (
                <th key={c.key} style={{ width: c.w }}>
                  {c.label}
                </th>
              ))}
              <th className="col-action">작업</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              // 행 순서가 곧 정체성이라 index 를 키로 쓴다(원본 서식의 NO 열과 동일)
              <tr key={i}>
                {cfg.columns.map((c) =>
                  c.calc ? (
                    <td key={c.key}>
                      <input className="q-calc-input" value={r[c.key] ?? ''} readOnly />
                    </td>
                  ) : (
                    <td key={c.key}>
                      {c.type === 'select' ? (
                        <select value={r[c.key] ?? ''} onChange={(e) => patch(i, c.key, e.target.value)}>
                          <option value="">선택</option>
                          {c.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={c.type === 'num' ? 'number' : 'text'}
                          value={r[c.key] ?? ''}
                          onChange={(e) => patch(i, c.key, e.target.value)}
                        />
                      )}
                    </td>
                  ),
                )}
                <td className="col-action">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
                  >
                    <Icon name="trash" className="btn-ic" />
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-sm btn-outline" onClick={() => onChange([...rows, {}])}>
        <Icon name="plus" className="btn-ic" />
        {cfg.addLabel}
      </button>
    </div>
  );
}

export default function QualityRecordLedger({ formKey, docNo }) {
  const def = FORM_FIELDS[formKey];
  const { confirm, toast } = useDialog();
  const { userProfile, isAdmin } = useAuth();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [printing, setPrinting] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('all');

  useEffect(() => subscribeRecords(formKey, setRows), [formKey]);

  // 판정 필드는 맨 뒤 배지 컬럼으로 따로 렌더하므로 일반 컬럼에서는 뺀다(중복 방지)
  const cols = useMemo(() => def.fields.filter((f) => f.col && !VERDICT_KEYS.includes(f.key)), [def]);
  const groups = useMemo(() => {
    const g = new Map();
    def.fields.forEach((f) => {
      const k = f.group || '기본정보';
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(f);
    });
    return [...g.entries()];
  }, [def]);

  const view = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows
      .filter((r) => verdictFilter === 'all' || verdictOf(r)?.label === verdictFilter)
      .filter(
        (r) =>
          !kw ||
          [r.recordNo, ...cols.map((c) => r[c.key])].filter(Boolean).some((v) => String(v).toLowerCase().includes(kw)),
      );
  }, [rows, cols, keyword, verdictFilter]);

  const counts = useMemo(() => {
    const c = { 합격: 0, 부적합: 0, 보류: 0 };
    rows.forEach((r) => {
      const v = verdictOf(r);
      if (v) c[v.label] += 1;
    });
    return c;
  }, [rows]);

  const hasVerdict = def.fields.some((f) => VERDICT_KEYS.includes(f.key));

  // 문서번호는 사내에 정해진 규칙이 있으므로 임의 채번하지 않고 입력받는다
  const openNew = () => setEditing({ recordNo: '' });

  // 문서형(원본이 한 장짜리 서식)은 양식 낱장에서 저장한다
  const saveSheet = async (draft) => {
    const { id, ...rest } = computeCalcFields(formKey, draft);
    setEditing(null);
    setPrinting(null);
    try {
      if (id) await updateRecord(id, rest);
      else await addRecord(formKey, rest);
      toast(id ? '수정했습니다.' : '등록했습니다.', 'success', 0);
    } catch (err) {
      console.error('[qualityRecords] 저장 실패:', err);
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  const setVal = (k, v) => setEditing((e) => computeCalcFields(formKey, { ...e, [k]: v }));

  const save = async () => {
    if (!String(editing.recordNo ?? '').trim()) {
      toast('문서번호를 입력하세요 (사내 문서번호 규칙에 따라)', 'error');
      return;
    }
    const missing = def.fields.filter((f) => f.required && !String(editing[f.key] ?? '').trim());
    if (missing.length) {
      toast(`${missing[0].label}을(를) 입력하세요`, 'error');
      return;
    }
    const { id, ...rest } = computeCalcFields(formKey, editing);
    setEditing(null); // 대기시키지 않는다 — 결과만 토스트로
    try {
      if (id) await updateRecord(id, rest);
      else await addRecord(formKey, rest);
      toast(id ? '수정했습니다.' : '등록했습니다.', 'success', 0);
    } catch (err) {
      console.error('[qualityRecords] 저장 실패:', err);
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  const remove = async (r) => {
    if (!(await confirm(`${r.recordNo}을(를) 휴지통으로 옮길까요?`))) return;
    try {
      await trashRecord(r, `${def.title} ${r.recordNo}`, userProfile?.name || '');
      toast('휴지통으로 이동했습니다.', 'success', 0);
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error', 0);
    }
  };

  return (
    <>
      <div className="q-ledger-head">
        <h3>
          {def.title}
          <span className="q-doc-badge">{docNo}</span>
        </h3>
        <div className="q-ledger-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={checked.size === 0}
            // 무엇을 출력할지 정해져야 하므로 선택 전에는 막되, 이유를 알 수 있게 안내한다
            title={checked.size === 0 ? '출력할 행을 왼쪽 체크박스로 선택하세요' : `${checked.size}건 출력`}
            onClick={() => setPrinting(view.filter((r) => checked.has(r.id)))}
          >
            <Icon name="doc" className="btn-ic" />
            출력{checked.size > 0 ? ` (${checked.size})` : ''}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => (def.paper ? navigate(`/quality/sheet/${formKey}/new`) : openNew())}
          >
            <Icon name="plus" className="btn-ic" />
            신규
          </button>
        </div>
      </div>

      <div className="q-summary">
        {hasVerdict &&
          Object.values(VERDICT).map((v) => (
            <button
              key={v.label}
              type="button"
              className={`q-summary-chip q-chip-${v.label === '합격' ? 'normal' : v.label === '부적합' ? 'over' : 'hold'} ${
                verdictFilter === v.label ? 'active' : ''
              }`}
              onClick={() => setVerdictFilter(verdictFilter === v.label ? 'all' : v.label)}
            >
              <i />
              {v.label}
              <b>{counts[v.label]}</b>
            </button>
          ))}
        <input
          className="q-search"
          placeholder="번호 · 내용 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-scroll-x">
          <table className="table cards-sm">
            <thead>
              <tr>
                <th className="q-check-col">
                  <input
                    type="checkbox"
                    aria-label="전체 선택"
                    title="전체 선택 — 출력하려면 먼저 선택하세요"
                    checked={view.length > 0 && checked.size === view.length}
                    onChange={(e) => setChecked(e.target.checked ? new Set(view.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th>번호</th>
                {cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {hasVerdict && <th>판정</th>}
                <th className="col-action">작업</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => {
                const v = verdictOf(r);
                return (
                  <tr
                    key={r.id}
                    className={def.paper ? 'table-clickable-row' : ''}
                    onClick={def.paper ? () => navigate(`/quality/sheet/${formKey}/${r.id}`) : undefined}
                  >
                    <td className="q-check-col" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`${r.recordNo} 선택`}
                        checked={checked.has(r.id)}
                        onChange={(e) => {
                          const next = new Set(checked);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          setChecked(next);
                        }}
                      />
                    </td>
                    <td className="q-num">{r.recordNo}</td>
                    {cols.map((c) => (
                      <td key={c.key} className={c.type === 'num' || c.type === 'date' ? 'q-num' : ''}>
                        {r[c.key] || '—'}
                      </td>
                    ))}
                    {hasVerdict && <td>{v ? <span className={`badge ${v.cls}`}>{v.label}</span> : '—'}</td>}
                    <td className="col-action" onClick={(e) => e.stopPropagation()}>
                      {!def.paper && (
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => setEditing(r)}>
                          수정
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(r)}>
                        <Icon name="trash" className="btn-ic" />
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
              {view.length === 0 && (
                <tr>
                  <td colSpan={cols.length + (hasVerdict ? 4 : 3)}>
                    <div className="q-todo">
                      <Icon name="doc" style={{ width: 34, height: 34 }} />
                      <b>등록된 항목이 없습니다</b>
                      <p>우측 상단 「신규」로 첫 항목을 등록하세요.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {view.length > 0 && (
          <div className="q-table-foot">
            전체 {rows.length}건{hasVerdict && ` · 합격 ${counts.합격} · 부적합 ${counts.부적합} · 보류 ${counts.보류}`}
          </div>
        )}
      </div>

      <Modal
        isOpen={!def.paper && !!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `${def.title} 수정` : `${def.title} 등록`}
        size="lg"
      >
        {editing && (
          <div className="form-body">
            <div className="form-group">
              <label>문서번호 *</label>
              <input
                value={editing.recordNo || ''}
                onChange={(e) => setVal('recordNo', e.target.value)}
                placeholder="사내 문서번호 규칙에 따라 입력"
                disabled={!isAdmin && !!editing.id}
              />
            </div>
            {def.lines && (
              <LineItems
                cfg={def.lines}
                lines={editing.lines}
                onChange={(v) => setEditing((e) => computeCalcFields(formKey, { ...e, lines: v }))}
              />
            )}
            {groups.map(([groupName, fields]) => (
              <div key={groupName} className="form-full q-form-group">
                {groupName !== '기본정보' && <div className="q-form-group-title">{groupName}</div>}
                <div className="form-body">
                  {fields.map((f) => (
                    <Field key={f.key} f={f} value={editing[f.key]} onChange={setVal} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            저장
          </button>
        </div>
      </Modal>

      {/* 문서형은 양식 낱장(조회·편집·인쇄 한 화면), 대장형은 읽기 전용 출력 */}
      {printing &&
        (def.paper ? (
          <QualitySheet
            formKey={formKey}
            docNo={docNo}
            record={printing}
            onSave={saveSheet}
            onClose={() => setPrinting(null)}
          />
        ) : (
          <QualityDocPrint formKey={formKey} docNo={docNo} record={printing} onClose={() => setPrinting(null)} />
        ))}

      {/* 문서형 신규·수정은 일반 모달 대신 양식 낱장으로 */}
      {def.paper && editing && (
        <QualitySheet
          formKey={formKey}
          docNo={docNo}
          record={editing}
          onSave={saveSheet}
          onClose={() => setEditing(null)}
        />
      )}

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['qualityRecords']}
        title="품질 기록 휴지통"
      />
    </>
  );
}
