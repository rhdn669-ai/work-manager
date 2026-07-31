import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../common/Icon';
import TrashModal from '../common/TrashModal';
import { useDialog } from '../common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { ASSET_STATUS, assetStatusOf } from '../../domain/qualityForms';
import { FORM_FIELDS } from '../../domain/qualityFormFields';
import { subscribeAssets, trashAsset } from '../../services/qualityAssetService';
import { subscribeTrashByType } from '../../services/trashService';
import QualityDocPrint from './QualityDocPrint';

// 자산 대장 (계측기·지그·치공구·툴)
// 화면 골격·조작 방식은 기록 대장(QualityRecordLedger)과 완전히 같다 —
// 행 클릭 → 양식 페이지, 체크 → 출력, 우측 끝 삭제. 자산에만 있는 것은
// 교정 상태 칩(정상·임박·초과)과 잔여 게이지뿐이다.
export default function QualityAssetLedger({ assetType, docNo, label }) {
  const formKey = `assets.${assetType}`;
  const def = FORM_FIELDS[formKey];
  const { confirm, toast } = useDialog();
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [all, setAll] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [printing, setPrinting] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => subscribeAssets(setAll), []);
  useEffect(() => subscribeTrashByType('qualityAssets', (t) => setTrashCount(t.length)), []);

  const cols = useMemo(() => def.fields.filter((f) => f.col), [def]);
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

  // 등록·수정은 기록 대장과 같이 양식 낱장 페이지에서 한다
  const openSheet = (id) => navigate(`/quality/sheet/${formKey}/${id}`);

  const remove = async (a) => {
    if (!(await confirm(`${a.assetNo} ${a.name}을(를) 휴지통으로 옮길까요?`))) return;
    try {
      await trashAsset(a, userProfile?.name || '');
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
            disabled={checked.size === 0}
            title={checked.size === 0 ? '출력할 행을 왼쪽 체크박스로 선택하세요' : `${checked.size}건 출력`}
            onClick={() => setPrinting(view.filter((r) => checked.has(r.id)))}
          >
            <Icon name="doc" className="btn-ic" />
            출력{checked.size > 0 ? ` (${checked.size})` : ''}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통{trashCount > 0 ? ` (${trashCount})` : ''}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openSheet('new')}>
            <Icon name="plus" className="btn-ic" />
            신규
          </button>
        </div>
      </div>

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
                <th>관리번호</th>
                {cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {hasCycle && <th>잔여</th>}
                {hasCycle && <th>상태</th>}
                <th className="col-action">작업</th>
              </tr>
            </thead>
            <tbody>
              {view.map((a) => (
                <tr key={a.id} className="table-clickable-row" onClick={() => openSheet(a.id)}>
                  <td className="q-check-col" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`${a.assetNo} 선택`}
                      checked={checked.has(a.id)}
                      onChange={(e) => {
                        const next = new Set(checked);
                        if (e.target.checked) next.add(a.id);
                        else next.delete(a.id);
                        setChecked(next);
                      }}
                    />
                  </td>
                  <td className="q-num">{a.assetNo}</td>
                  {cols.map((c) => (
                    <td key={c.key} className={c.type === 'num' || c.type === 'date' ? 'q-num' : ''}>
                      {a[c.key] || '—'}
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
                  <td className="col-action" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(a)}>
                      <Icon name="trash" className="btn-ic" />
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {view.length === 0 && (
                <tr>
                  <td colSpan={cols.length + (hasCycle ? 5 : 3)}>
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
