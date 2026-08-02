import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import TrashModal from '../common/TrashModal';
import { useDialog } from '../common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { VERDICT } from '../../domain/qualityForms';
import { COMPANIES } from '../../domain/production';
import { FORM_FIELDS, computeCalcFields } from '../../domain/qualityFormFields';
import { subscribeRecords, addRecord, updateRecord, trashRecord } from '../../services/qualityRecordService';
import { QUALITY_GOAL_SEED } from '../../domain/qualityGoalSeed';
import { subscribeTrashByType } from '../../services/trashService';
import QualityDocPrint from './QualityDocPrint';
import LedgerCell from './LedgerCell';

// 양식 엔진 — 서식 정의(FORM_FIELDS)만 바꿔 10종 대장이 이 컴포넌트 하나를 공유한다.
// 화면 골격은 스티치 「대장 목록 공통 골격」을 따른다:
// 헤더(서식명+문서번호 / 우측 휴지통·신규) → 필터바 → 표(판정 배지 + 우측 작업) → 하단 집계

// 판정 성격의 필드를 찾아 배지로 렌더 — 서식마다 이름이 다르다(합불/종합/최종/전체)
const VERDICT_KEYS = ['passFailResult', 'overallResult', 'finalResult', 'finalJudgement'];
const verdictOf = (row) => {
  const raw = VERDICT_KEYS.map((k) => row[k]).find(Boolean);
  return Object.values(VERDICT).find((v) => v.label === raw) || null;
};

export default function QualityRecordLedger({ formKey, docNo }) {
  const def = FORM_FIELDS[formKey];
  const { confirm, toast } = useDialog();
  const { userProfile } = useAuth();
  const [rows, setRows] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0); // 휴지통 버튼 옆 건수
  const [printing, setPrinting] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all'); // 메티스 · 디에이치

  useEffect(() => subscribeRecords(formKey, setRows), [formKey]);
  useEffect(() => subscribeTrashByType('qualityRecords', (t) => setTrashCount(t.length)), []);

  // 대장형 vs 문서형 — 원본의 성격 그대로 (2026-08-02 대표님)
  //  · 대장형: 표 자체가 문서다. 낱장 출력·페이지 이동 없이 목록에서 모든 칸을 보고 고친다.
  //  · 문서형: 병합 많은 한 장짜리 서식(성적서·신청서·교육일지·평가시트). 양식 페이지로 간다.
  const isLedger = !def.paper && !def.lines;
  // 대장형은 모든 필드를 컬럼으로 편다(원본 엑셀 대장이 그렇다). 문서형은 요약 컬럼만.
  const cols = useMemo(
    () => def.fields.filter((f) => (isLedger ? !VERDICT_KEYS.includes(f.key) : f.col && !VERDICT_KEYS.includes(f.key))),
    [def, isLedger],
  );

  // 셀 편집 — 값이 바뀐 칸만 즉시 저장한다(엑셀처럼 칸을 고치면 바로 반영)
  const editCell = async (row, key, value) => {
    if (String(row[key] ?? '') === String(value ?? '')) return;
    try {
      const { id, formKey: _fk, ...rest } = computeCalcFields(formKey, { ...row, [key]: value });
      await updateRecord(id, rest);
    } catch (err) {
      console.error('[qualityRecords] 셀 저장 실패:', err);
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  const view = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows
      .filter((r) => verdictFilter === 'all' || verdictOf(r)?.label === verdictFilter)
      .filter((r) => companyFilter === 'all' || r.customerName === companyFilter)
      .filter(
        (r) =>
          !kw ||
          [r.recordNo, ...cols.map((c) => r[c.key])].filter(Boolean).some((v) => String(v).toLowerCase().includes(kw)),
      );
  }, [rows, cols, keyword, verdictFilter, companyFilter]);

  const counts = useMemo(() => {
    const c = { 합격: 0, 부적합: 0, 보류: 0 };
    rows.forEach((r) => {
      const v = verdictOf(r);
      if (v) c[v.label] += 1;
    });
    return c;
  }, [rows]);

  const hasVerdict = def.fields.some((f) => VERDICT_KEYS.includes(f.key));
  // 발주사(메티스·디에이치)로 나눠 보는 건 고객사 칸이 있는 서식에서만 뜻이 있다
  const hasCompany = def.fields.some((f) => f.key === 'customerName');
  const companyCounts = useMemo(() => {
    const base = Object.fromEntries(COMPANIES.map((c) => [c, 0]));
    rows.forEach((r) => {
      if (base[r.customerName] != null) base[r.customerName] += 1;
    });
    return base;
  }, [rows]);

  // 등록·수정은 전부 양식 낱장 페이지에서 한다(모달 편집 폐지 — 출력물과 같은 서식에 바로 입력)
  const openSheet = (id) => navigate(`/quality/sheet/${formKey}/${id}`);

  // 품질목표는 매년 같은 항목을 다시 세운다 — 빈 대장일 때 기본안을 한 번에 넣어 시작점을 준다.
  // 임의로 잡은 값이 섞여 있으므로(qualityGoalSeed 주석 참고) 확인 후 고쳐 쓰도록 안내한다.
  const seedGoals = async () => {
    const year = new Date().getFullYear();
    if (
      !(await confirm(
        `${year}년 품질목표 기본안 ${QUALITY_GOAL_SEED.length}건을 넣을까요?
` + '출하검사 불량률만 원본 값이고 나머지 4건은 임의로 잡은 값입니다 — 넣은 뒤 사내 기준에 맞게 고쳐 주세요.',
      ))
    )
      return;
    try {
      for (const g of QUALITY_GOAL_SEED) {
        const { source, ...rest } = g;
        await addRecord('master.goal', {
          ...rest,
          recordNo: '',
          managementYear: year,
          remarks: `[${source}] ${rest.remarks}`,
        });
      }
      toast(`기본안 ${QUALITY_GOAL_SEED.length}건을 넣었습니다. 목표값을 확인해 주세요.`, 'success', 0);
    } catch {
      toast('기본안 등록 중 오류가 발생했습니다', 'error', 0);
    }
  };

  // 대장은 빈 행을 먼저 만들고 칸을 채워 넣는다(엑셀 대장에 줄을 추가하는 방식)
  const addBlankRow = async () => {
    try {
      await addRecord(formKey, { recordNo: '' });
    } catch {
      toast('행 추가 중 오류가 발생했습니다', 'error', 0);
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
          {isLedger ? (
            /* 대장은 낱장이 아니라 대장 자체가 문서다 — 지금 보이는 목록을 표 그대로 출력한다 */
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={view.length === 0}
              title={view.length === 0 ? '출력할 내용이 없습니다' : `${view.length}건이 담긴 대장을 출력합니다`}
              onClick={() => setPrinting(view)}
            >
              <Icon name="doc" className="btn-ic" />
              대장 출력{view.length > 0 ? ` (${view.length})` : ''}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={checked.size === 0}
              title={checked.size === 0 ? '출력할 행을 왼쪽 체크박스로 선택하세요' : `${checked.size}건 출력`}
              onClick={() => setPrinting(view.filter((r) => checked.has(r.id)))}
            >
              <Icon name="doc" className="btn-ic" />
              출력{checked.size > 0 ? ` (${checked.size})` : ''}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통{trashCount > 0 ? ` (${trashCount})` : ''}
          </button>
          {formKey === 'master.goal' && rows.length === 0 && (
            <button type="button" className="btn btn-sm btn-outline" onClick={seedGoals}>
              <Icon name="doc" className="btn-ic" />
              기본안 넣기
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={isLedger ? addBlankRow : () => openSheet('new')}
          >
            <Icon name="plus" className="btn-ic" />
            {isLedger ? '행 추가' : '신규'}
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
        {hasCompany &&
          COMPANIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`q-summary-chip q-chip-company ${companyFilter === c ? 'active' : ''}`}
              onClick={() => setCompanyFilter(companyFilter === c ? 'all' : c)}
            >
              <i />
              {c}
              <b>{companyCounts[c]}</b>
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
                {!isLedger && (
                  <th className="q-check-col">
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      title="전체 선택 — 출력하려면 먼저 선택하세요"
                      checked={view.length > 0 && checked.size === view.length}
                      onChange={(e) => setChecked(e.target.checked ? new Set(view.map((r) => r.id)) : new Set())}
                    />
                  </th>
                )}
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
                    className={isLedger ? '' : 'table-clickable-row'}
                    onClick={isLedger ? undefined : () => openSheet(r.id)}
                  >
                    {!isLedger && (
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
                    )}
                    <td className="q-num">
                      {isLedger ? (
                        <LedgerCell
                          f={{ key: 'recordNo', type: 'text' }}
                          row={r}
                          onCommit={editCell}
                          readOnly={r.sourceType === 'production'}
                        />
                      ) : (
                        r.recordNo ||
                        (r.sourceType === 'production' ? (
                          <span className="purchase-badge purchase-badge-replied">생산 자동</span>
                        ) : (
                          '—'
                        ))
                      )}
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className={c.type === 'num' || c.type === 'date' ? 'q-num' : ''}>
                        {isLedger ? (
                          <LedgerCell
                            f={c}
                            row={r}
                            onCommit={editCell}
                            readOnly={c.calc || r.sourceType === 'production'}
                          />
                        ) : (
                          r[c.key] || '—'
                        )}
                      </td>
                    ))}
                    {hasVerdict &&
                      (isLedger ? (
                        <td>
                          <LedgerCell
                            f={def.fields.find((f) => VERDICT_KEYS.includes(f.key))}
                            row={r}
                            onCommit={editCell}
                            readOnly={r.sourceType === 'production'}
                          />
                        </td>
                      ) : (
                        <td>{v ? <span className={`badge ${v.cls}`}>{v.label}</span> : '—'}</td>
                      ))}
                    <td className="col-action" onClick={(e) => e.stopPropagation()}>
                      {r.sourceType === 'production' ? (
                        <span
                          className="q-locked"
                          title="생산현황에서 자동으로 만들어진 기록입니다. 생산현황에서 불량을 지우면 여기서도 정리됩니다."
                        >
                          생산현황에서 삭제
                        </span>
                      ) : (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(r)}>
                          <Icon name="trash" className="btn-ic" />
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {view.length === 0 && (
                <tr>
                  <td colSpan={cols.length + (hasVerdict ? 3 : 2) + (isLedger ? 0 : 1)}>
                    <div className="q-todo">
                      <Icon name="doc" style={{ width: 34, height: 34 }} />
                      <b>등록된 항목이 없습니다</b>
                      <p>우측 상단 「{isLedger ? '행 추가' : '신규'}」로 첫 항목을 등록하세요.</p>
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

      {/* 출력 — 화면 양식과 같은 서식으로, 선택한 건수만큼 이어 붙여 인쇄 */}
      {printing && (
        <QualityDocPrint formKey={formKey} docNo={docNo} record={printing} onClose={() => setPrinting(null)} />
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
