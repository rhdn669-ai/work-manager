import { useEffect, useMemo, useState } from 'react';
import Icon from '../common/Icon';
import TrashModal from '../common/TrashModal';
import EditModeButton from '../common/EditModeButton';
import { useDialog } from '../common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { ASSET_STATUS, assetStatusOf } from '../../domain/qualityForms';
import { FORM_FIELDS, computeCalcFields, colWidthOf } from '../../domain/qualityFormFields';
import { subscribeAssets, addAsset, updateAsset, trashAsset } from '../../services/qualityAssetService';
import { subscribeTrashByType } from '../../services/trashService';
import QualityDocPrint from './QualityDocPrint';
import LedgerCell from './LedgerCell';

// 자산 대장 (계측기·지그·치공구·툴)
// 화면 골격·조작 방식은 기록 대장(QualityRecordLedger)과 완전히 같다 —
// 행 클릭 → 양식 페이지, 체크 → 출력, 우측 끝 삭제. 자산에만 있는 것은
// 교정 상태 칩(정상·임박·초과)과 잔여 게이지뿐이다.
export default function QualityAssetLedger({ assetType, docNo, label }) {
  const formKey = `assets.${assetType}`;
  const def = FORM_FIELDS[formKey];
  const { confirm, toast } = useDialog();
  const { userProfile, isAdmin } = useAuth();
  const [all, setAll] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [printing, setPrinting] = useState(null);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  // 「잠금」 — 풀었을 때만 체크박스 + 선택 삭제 (2026-09-04 대표님 「잠금」 통일)
  const [editMode, setEditMode] = useState(false);
  const [pick, setPick] = useState(() => new Set());

  useEffect(() => subscribeAssets(setAll), []);
  useEffect(() => subscribeTrashByType('qualityAssets', (t) => setTrashCount(t.length)), []);

  // 자산은 전부 대장형이다 — 모든 칸을 표에 펴고 여기서 바로 고친다
  const cols = useMemo(() => def.fields, [def]);

  const editCell = async (row, key, value) => {
    if (String(row[key] ?? '') === String(value ?? '')) return;
    try {
      const { id, st: _st, ...rest } = computeCalcFields(formKey, { ...row, [key]: value });
      await updateAsset(id, { ...rest, cycleMonths: Number(rest.cycleMonths) || 0 });
    } catch (err) {
      console.error('[qualityAssets] 셀 저장 실패:', err);
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  const addBlankRow = async () => {
    try {
      await addAsset({ assetType, assetNo: '' });
    } catch {
      toast('행 추가 중 오류가 발생했습니다', 'error', 0);
    }
  };
  // JIG(706A)는 원본에 교정주기·차기일 칸이 없다 — 상태/잔여 칸을 띄우지 않는다
  const hasCycle = useMemo(() => def.fields.some((f) => f.key === 'nextDate'), [def]);

  const view = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return all
      .filter((a) => a.assetType === assetType)
      .map((a) => ({ ...a, st: assetStatusOf(a.nextDate) }))
      .filter((a) => statusFilter === 'all' || a.st.key === statusFilter)
      .filter(
        (a) =>
          !kw ||
          [a.assetNo, ...cols.map((c) => a[c.key])].filter(Boolean).some((v) => String(v).toLowerCase().includes(kw)),
      );
  }, [all, assetType, keyword, statusFilter, cols]);

  const counts = useMemo(() => {
    const base = { normal: 0, due: 0, over: 0 };
    all
      .filter((a) => a.assetType === assetType)
      .forEach((a) => {
        base[assetStatusOf(a.nextDate).key] += 1;
      });
    return base;
  }, [all, assetType]);
  const total = counts.normal + counts.due + counts.over;

  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set()); // 잠그면 골라 둔 것도 함께 푼다
      return !v;
    });
  }

  function togglePick(id) {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllPick() {
    setPick((prev) => (prev.size === view.length ? new Set() : new Set(view.map((a) => a.id))));
  }

  // 고른 자산을 한꺼번에 휴지통으로 (2026-09-04 대표님 「잠금」 통일 — 행별 삭제 버튼 폐지)
  const deletePicked = async () => {
    const targets = view.filter((a) => pick.has(a.id));
    if (targets.length === 0) return;
    if (!(await confirm(`고른 ${targets.length}건을 휴지통으로 보내시겠습니까?`))) return;
    try {
      for (const a of targets) {
        await trashAsset(a, userProfile?.name || '');
      }
      setPick(new Set());
      toast('휴지통으로 이동했습니다.', 'success', 0);
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error', 0);
    }
  };

  return (
    <>
      <div className="q-ledger-head">
        <h3>
          {label}
          <span className="q-doc-badge">{docNo}</span>
        </h3>
        <div className="q-ledger-actions">
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
          {isAdmin && (
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
              <Icon name="trash" className="btn-ic" />
              휴지통{trashCount > 0 ? ` (${trashCount})` : ''}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={addBlankRow}>
            <Icon name="plus" className="btn-ic" />행 추가
          </button>
          {/* 지우는 것은 관리자만 (2026-08-12 대표님) — 잠금도 같이 관리자 전용 (2026-09-04 「잠금」 통일) */}
          {isAdmin && <EditModeButton on={editMode} onToggle={toggleEditMode} />}
        </div>
      </div>

      {editMode && pick.size > 0 && (
        <div className="sel-bar">
          <span className="sel-count">
            <strong>{pick.size}</strong>건 골랐습니다
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={deletePicked}>
            <Icon name="trash" className="btn-ic" />
            선택 삭제
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      <div className="q-summary">
        {hasCycle &&
          ['normal', 'due', 'over'].map((k) => (
            <button
              key={k}
              type="button"
              className={`q-summary-chip q-chip-${k} ${statusFilter === k ? 'active' : ''}`}
              onClick={() => setStatusFilter(statusFilter === k ? 'all' : k)}
            >
              <i />
              {ASSET_STATUS[k].label}
              <b>{counts[k]}</b>
            </button>
          ))}
        <div className="q-summary-bar" aria-hidden="true">
          {hasCycle &&
            total > 0 &&
            ['normal', 'due', 'over'].map((k) => (
              <span key={k} className={`q-bar-${k}`} style={{ width: `${(counts[k] / total) * 100}%` }} />
            ))}
        </div>
        <input
          className="q-search"
          placeholder="번호 · 내용 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-scroll-x">
          <table className="table cards-sm q-grid-table">
            <colgroup>
              {editMode && <col className="w-no" />}
              <col className="w-no" />
              {cols.map((c) => (
                <col key={c.key} className={colWidthOf(c)} />
              ))}
              {hasCycle && <col className="w-text" />}
              {hasCycle && <col className="w-select" />}
              <col className="w-act" />
            </colgroup>
            <thead>
              <tr>
                {editMode && (
                  <th scope="col" className="drag-handle-cell">
                    <input
                      type="checkbox"
                      className="sel-check"
                      checked={view.length > 0 && pick.size === view.length}
                      onChange={toggleAllPick}
                      aria-label="전체 선택"
                    />
                  </th>
                )}
                <th scope="col">관리번호</th>
                {cols.map((c) => (
                  <th scope="col" key={c.key}>
                    {c.label}
                  </th>
                ))}
                {hasCycle && <th scope="col">잔여</th>}
                {hasCycle && <th scope="col">상태</th>}
                <th scope="col" className="col-action">
                  작업
                </th>
              </tr>
            </thead>
            <tbody>
              {view.map((a) => (
                <tr key={a.id} className={editMode && pick.has(a.id) ? 'is-checked' : undefined}>
                  {editMode && (
                    <td className="drag-handle-cell" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="sel-check"
                        checked={pick.has(a.id)}
                        onChange={() => togglePick(a.id)}
                        aria-label={`${a.assetNo || ''} 선택`}
                      />
                    </td>
                  )}
                  <td className="q-num">
                    <LedgerCell f={{ key: 'assetNo', type: 'text' }} row={a} onCommit={editCell} />
                  </td>
                  {cols.map((c) => (
                    <td key={c.key}>
                      <LedgerCell f={c} row={a} onCommit={editCell} readOnly={!!c.calc} />
                    </td>
                  ))}
                  {hasCycle && (
                    <td>
                      {a.st.days == null ? (
                        '—'
                      ) : (
                        <span className="q-remain">
                          <span className={`q-gauge q-gauge-${a.st.key}`}>
                            <i style={{ width: `${Math.max(0, Math.min(100, (a.st.days / 365) * 100))}%` }} />
                          </span>
                          <b>{a.st.days < 0 ? `${-a.st.days}일 초과` : `${a.st.days}일`}</b>
                        </span>
                      )}
                    </td>
                  )}
                  {hasCycle && (
                    <td>
                      <span className={`badge ${ASSET_STATUS[a.st.key].cls}`}>{ASSET_STATUS[a.st.key].label}</span>
                    </td>
                  )}
                  {/* 개별 삭제 버튼 폐지 — 지우는 것은 관리자만, 잠금 풀고 체크 → 선택 삭제
                      (2026-08-12 대표님 권한 구분 · 2026-09-04 대표님 「잠금」 통일) */}
                  <td className="col-action" />
                </tr>
              ))}
              {view.length === 0 && (
                <tr>
                  <td colSpan={cols.length + (hasCycle ? 4 : 2) + (editMode ? 1 : 0)}>
                    <div className="q-todo">
                      <Icon name="doc" style={{ width: 34, height: 34 }} />
                      <b>등록된 항목이 없습니다</b>
                      <p>우측 상단 「행 추가」로 첫 항목을 등록하세요.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {view.length > 0 && (
          <div className="q-table-foot">
            전체 {total}건{hasCycle && ` · 정상 ${counts.normal} · 임박 ${counts.due} · 초과 ${counts.over}`}
          </div>
        )}
      </div>

      {printing && (
        <QualityDocPrint formKey={formKey} docNo={docNo} record={printing} onClose={() => setPrinting(null)} />
      )}

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['qualityAssets']}
        title="품질 자산 휴지통"
      />
    </>
  );
}
