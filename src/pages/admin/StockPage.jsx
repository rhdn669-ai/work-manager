import { useState, useEffect, useMemo } from 'react';
import {
  subscribePurchaseItems,
  setItemStock,
  addPurchaseItem,
  clearItemStock,
  nextMainCode,
} from '../../services/purchaseService';
import { useDialog } from '../../components/common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import Skeleton from '../../components/common/Skeleton';
import EmptyState from '../../components/common/EmptyState';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import EditModeButton from '../../components/common/EditModeButton';
import { isStockTracked } from '../../domain/stock';

// 재고 — 품목별로 창고에 몇 개 남았는지 손으로 적어 두는 곳.
// 발주해도 자동으로 줄지 않는다. 자재를 꺼내 쓴 뒤에는 여기서 직접 고쳐야 한다.
// 여기 적힌 수량만큼 발주서 작성 때 발주 수량에서 빠진다.

const FILTERS = [
  { value: 'all', label: '전체' }, // 0 은 자동으로 빠진다 (2026-09-04 대표님 「0개는 리스트에서 자동 제외」)
  { value: 'has', label: '재고 있는 것만' },
  { value: 'none', label: '0 · 모자란 것 보기' },
];

function fmtWhen(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function StockPage() {
  const { toast, confirm } = useDialog();
  const { userProfile } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState({}); // 입력 중인 문자열 {id: '7'}
  const [saving, setSaving] = useState('');
  const [historyItem, setHistoryItem] = useState(null);
  // 새 항목 직접 추가 — 품목 탭에 없는 자재도 여기서 바로 만든다
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ code: '', name: '', spec: '', unit: '', stockQty: '', existingId: '' });
  const [adding, setAdding] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [newMode, setNewMode] = useState(false); // 검색으로 못 찾아 새로 만드는 중
  // 「잠금」 — 풀었을 때만 체크박스 + 선택 빼기 (2026-09-04 대표님 「잠금」 통일)
  const [editMode, setEditMode] = useState(false);
  const [pick, setPick] = useState(() => new Set());

  useEffect(
    () =>
      subscribePurchaseItems((list) => {
        setItems(list);
        setLoading(false);
      }),
    [],
  );

  // 재고를 챙길 자재만 여기 올린다 — 품목 전체를 늘어놓으면 정작 볼 것이 묻힌다.
  // 「항목 추가」로 올린 것(stockQty 필드가 생긴 것)만 목록에 나온다.
  const tracked = useMemo(() => items.filter(isStockTracked), [items]);

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return tracked.filter((it) => {
      const stock = Number(it.stockQty) || 0;
      // 0 인 품목은 목록에서 자동으로 뺀다 — 「0 · 모자란 것 보기」로만 꺼내 볼 수 있다
      if (filter !== 'none' && stock === 0) return false;
      if (filter === 'has' && stock <= 0) return false;
      if (filter === 'none' && stock > 0) return false;
      if (!kw) return true;
      return [it.code, it.name, it.spec, it.maker, it.category].some((v) => (v || '').toLowerCase().includes(kw));
    });
  }, [tracked, search, filter]);

  const summary = useMemo(() => {
    const withStock = tracked.filter((it) => (Number(it.stockQty) || 0) > 0);
    return {
      kinds: withStock.length,
      total: withStock.reduce((s, it) => s + (Number(it.stockQty) || 0), 0),
    };
  }, [tracked]);

  async function commit(it) {
    const raw = edit[it.id];
    if (raw === undefined) return;
    setEdit((p) => {
      const n = { ...p };
      delete n[it.id];
      return n;
    });
    const from = Number(it.stockQty) || 0;
    const to = Number(raw) || 0; // 모자란 수량은 음수로 적어 둘 수 있다
    if (to === from) return;
    setSaving(it.id);
    try {
      await setItemStock(it.id, { from, to, byName: userProfile?.name || '' });
    } catch {
      toast('재고 저장 중 오류가 발생했습니다', 'error');
    } finally {
      setSaving('');
    }
  }

  // 재고 화면에서 만든 항목도 품목 목록에 함께 들어간다.
  // 따로 관리하면 같은 자재가 두 군데 생겨 발주 차감이 어긋난다.
  // 찾아서 고르는 것이 기본, 없을 때만 새로 만든다.
  // 코드 자동 채번은 새로 만들 때만 — 고르는 자리에 미리 채워 두면 헷갈린다.
  function openAdd() {
    setAddSearch('');
    setNewMode(false);
    setAddForm({ code: '', name: '', spec: '', unit: '', stockQty: '', existingId: '' });
    setAddOpen(true);
  }

  // 코드·품명·규격을 가리지 않고 친 대로 찾는다. 이미 재고 목록에 올라 있는 것은 뺀다.
  const addCandidates = useMemo(() => {
    const kw = addSearch.trim().toLowerCase();
    if (!kw) return [];
    // 대분류(IOPN-000 처럼 소분류 번호가 없는 그룹 머리)는 실제 자재가 아니라 제외한다.
    // 코드 모양과, 다른 품목의 groupKey가 가리키는 id 양쪽으로 걸러낸다(BOM 품목 고르기와 같은 규칙).
    const mainIds = new Set(items.map((m) => m.groupKey).filter(Boolean));
    return items
      .filter((it) => !isStockTracked(it))
      .filter((it) => !/^IOPN-\d+$/.test(it.code || '') && !mainIds.has(it.id))
      .filter((it) => [it.code, it.name, it.spec, it.maker].some((v) => (v || '').toLowerCase().includes(kw)))
      .slice(0, 12);
  }, [items, addSearch]);

  function pickExisting(it) {
    setAddForm({
      existingId: it.id,
      code: it.code || '',
      name: it.name || '',
      spec: it.spec || '',
      unit: it.unit || '',
      stockQty: '',
    });
  }

  function startNew() {
    setNewMode(true);
    setAddForm({ code: nextMainCode(items), name: addSearch.trim(), spec: '', unit: '', stockQty: '', existingId: '' });
  }

  async function submitAdd() {
    const name = addForm.name.trim();
    if (!name) return;
    setAdding(true);
    try {
      if (addForm.existingId) {
        // 이미 있는 품목 — 재고 수량만 붙여 목록에 올린다
        await setItemStock(addForm.existingId, {
          from: 0,
          to: Number(addForm.stockQty) || 0,
          byName: userProfile?.name || '',
        });
        setAddOpen(false);
        toast(`"${name}"을(를) 재고 목록에 올렸습니다`, 'success');
        return;
      }
      const dup = items.find((it) => (it.name || '').trim() === name && (it.spec || '').trim() === addForm.spec.trim());
      if (dup) {
        toast('같은 품명·규격의 품목이 이미 있습니다 — 아래 목록에서 고르세요', 'error');
        return;
      }
      await addPurchaseItem({
        code: addForm.code.trim(),
        name,
        spec: addForm.spec.trim(),
        unit: addForm.unit.trim(),
        stockQty: Number(addForm.stockQty) || 0,
      });
      setAddOpen(false);
      toast(`"${name}"을(를) 품목과 재고 목록에 추가했습니다`, 'success');
    } catch {
      toast('항목 추가 중 오류가 발생했습니다', 'error');
    } finally {
      setAdding(false);
    }
  }

  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set());
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
    setPick((prev) => (prev.size === shown.length ? new Set() : new Set(shown.map((it) => it.id))));
  }

  // 고른 항목을 한꺼번에 재고 목록에서 내린다 — 품목 자체는 그대로 남는다 (기존 removeFromList와 같은 로직)
  async function deletePicked() {
    const targets = shown.filter((it) => pick.has(it.id));
    if (targets.length === 0) return;
    const ok = await confirm({
      title: '재고 목록에서 빼기',
      message: `고른 ${targets.length}건을 재고 목록에서 뺍니다.\n\n품목 자체는 지워지지 않고, 발주할 때 재고가 빠지지 않게 됩니다.`,
    });
    if (!ok) return;
    try {
      for (const it of targets) {
        await clearItemStock(it.id);
      }
      setPick(new Set());
    } catch {
      toast('목록에서 빼는 중 오류가 발생했습니다', 'error');
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="stock-page">
      <div className="page-header">
        <h2>재고</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={openAdd}>
            <Icon name="plus" className="btn-ic" />
            항목 추가
          </button>
          <EditModeButton on={editMode} onToggle={toggleEditMode} />
        </div>
      </div>

      {editMode && pick.size > 0 && (
        <div className="sel-bar">
          <span className="sel-count">
            <strong>{pick.size}</strong>건 골랐습니다
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={deletePicked}>
            <Icon name="trash" className="btn-ic" />
            선택 빼기
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      <p className="field-hint" style={{ marginBottom: 12 }}>
        창고에 남은 수량을 직접 적어 둡니다. 발주서를 작성하면 여기 적힌 만큼 발주 수량에서 빠집니다. 자재를 꺼내 쓴
        뒤에는 이곳에서 수량을 고쳐 주세요.
      </p>

      <div className="stock-filters no-print">
        <input
          type="text"
          className="stock-search"
          placeholder="코드 · 품명 · 규격 · 메이커 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={filter}
          onChange={setFilter}
          options={FILTERS}
          className="stock-filter-select"
          ariaLabel="재고 필터"
        />
        <span className="stock-summary">
          재고 있는 품목 <strong>{summary.kinds}</strong>종 · 합계 <strong>{summary.total.toLocaleString()}</strong>
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={tracked.length === 0 ? '재고를 챙길 자재가 아직 없습니다' : '해당 조건의 항목이 없습니다'}
          desc={
            tracked.length === 0
              ? '우측 상단 「항목 추가」로 창고에 두고 쓰는 자재를 올리세요. 여기 올린 것만 발주할 때 수량에서 빠집니다.'
              : '검색어나 필터를 바꿔 보세요.'
          }
          action={
            tracked.length === 0 ? (
              <button type="button" className="btn btn-primary" onClick={openAdd}>
                <Icon name="plus" className="btn-ic" />
                항목 추가
              </button>
            ) : null
          }
        />
      ) : (
        <div className="table-scroll-x">
          <table className="table cards-sm stock-table">
            <colgroup>
              {editMode && <col style={{ width: 36 }} />}
              <col style={{ width: '13%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '29%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                {editMode && (
                  <th scope="col" className="drag-handle-cell">
                    <input
                      type="checkbox"
                      className="sel-check"
                      checked={shown.length > 0 && pick.size === shown.length}
                      onChange={toggleAllPick}
                      aria-label="전체 선택"
                    />
                  </th>
                )}
                <th scope="col">코드</th>
                <th scope="col">품명</th>
                <th scope="col">규격</th>
                <th scope="col" className="col-unit">
                  단위
                </th>
                <th scope="col" className="col-num">
                  재고
                </th>
                <th scope="col" className="col-action">
                  최근 조정
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => {
                const stock = Number(it.stockQty) || 0;
                const value = edit[it.id] !== undefined ? edit[it.id] : String(stock);
                const hist = Array.isArray(it.stockHistory) ? it.stockHistory : [];
                return (
                  <tr
                    key={it.id}
                    className={
                      `${stock > 0 ? 'stock-row-has' : ''}${editMode && pick.has(it.id) ? ' is-checked' : ''}`.trim() ||
                      undefined
                    }
                  >
                    {editMode && (
                      <td className="drag-handle-cell" data-label="" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="sel-check"
                          checked={pick.has(it.id)}
                          onChange={() => togglePick(it.id)}
                          aria-label="뺄 항목 고르기"
                        />
                      </td>
                    )}
                    <td data-label="코드" className="u-ellipsis-1" title={it.code || ''}>
                      {it.code || '-'}
                    </td>
                    <td data-label="품명" className="u-ellipsis-1" title={it.name || ''}>
                      {it.name || '-'}
                    </td>
                    <td data-label="규격" className="u-ellipsis-1" title={it.spec || ''}>
                      {it.spec || '-'}
                    </td>
                    <td data-label="단위" className="col-unit">
                      {it.unit || '-'}
                    </td>
                    <td data-label="재고" className="col-num">
                      <input
                        type="number"
                        className={`num-input stock-input${stock < 0 ? ' is-minus' : ''}`}
                        value={value}
                        disabled={saving === it.id}
                        onChange={(e) => setEdit((p) => ({ ...p, [it.id]: e.target.value }))}
                        onBlur={() => commit(it)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </td>
                    <td data-label="최근 조정" className="col-action">
                      <div className="row-actions">
                        {hist.length > 0 && (
                          <>
                            <span className="stock-last">
                              {fmtWhen(it.stockUpdatedAt)} {it.stockUpdatedBy || ''}
                            </span>
                            <button type="button" className="btn btn-sm btn-outline" onClick={() => setHistoryItem(it)}>
                              이력
                            </button>
                          </>
                        )}
                        {/* 행별 빼기는 뺐다 — 「잠금」 풀고 체크 → 선택 빼기 (2026-09-04 대표님 「잠금」 통일) */}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={addOpen} onClose={() => setAddOpen(false)} title="항목 추가">
        {!addForm.existingId && !newMode ? (
          <>
            <p className="field-hint" style={{ marginBottom: 12 }}>
              창고에 두고 쓰는 자재를 찾아 올립니다. 코드·품명·규격 무엇으로 찾아도 됩니다.
            </p>
            <input
              type="text"
              className="stock-search"
              style={{ width: '100%' }}
              placeholder="코드 · 품명 · 규격 · 메이커 검색"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              autoFocus
            />
            <div className="stock-pick-list" style={{ marginTop: 10 }}>
              {addSearch.trim() === '' ? (
                <p className="field-hint">찾을 말을 입력하세요.</p>
              ) : addCandidates.length === 0 ? (
                <p className="field-hint">일치하는 품목이 없습니다. 아래에서 새로 만들 수 있습니다.</p>
              ) : (
                addCandidates.map((it) => (
                  <button key={it.id} type="button" className="stock-pick" onClick={() => pickExisting(it)}>
                    <span className="stock-pick-code">{it.code || '-'}</span>
                    <span className="stock-pick-name">{it.name}</span>
                    <span className="stock-pick-spec">{it.spec || ''}</span>
                  </button>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setAddOpen(false)}>
                취소
              </button>
              <button type="button" className="btn btn-outline" onClick={startNew}>
                <Icon name="plus" className="btn-ic" />새 품목 만들기
              </button>
            </div>
          </>
        ) : (
          <>
            {addForm.existingId ? (
              <div className="stock-chosen">
                <span className="stock-pick-code">{addForm.code || '-'}</span>
                <span className="stock-pick-name">{addForm.name}</span>
                <span className="stock-pick-spec">{addForm.spec || ''}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setAddForm((f) => ({ ...f, existingId: '' }))}
                >
                  다시 고르기
                </button>
              </div>
            ) : (
              <>
                <p className="field-hint" style={{ marginBottom: 12 }}>
                  품목 탭에 없는 자재를 새로 만듭니다. 만든 항목은 <strong>품목 목록에도 함께 등록</strong>됩니다.
                </p>
                <div className="form-row">
                  <div className="form-group">
                    <label>코드</label>
                    <input
                      aria-label="코드"
                      type="text"
                      value={addForm.code}
                      onChange={(e) => setAddForm((f) => ({ ...f, code: e.target.value }))}
                      placeholder="IOPN-000"
                      maxLength={30}
                    />
                  </div>
                  <div className="form-group">
                    <label>단위</label>
                    <input
                      aria-label="단위"
                      type="text"
                      value={addForm.unit}
                      onChange={(e) => setAddForm((f) => ({ ...f, unit: e.target.value }))}
                      placeholder="개 · m · roll/610m"
                      maxLength={30}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>품명</label>
                  <input
                    aria-label="품명"
                    type="text"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="예) CP"
                    autoFocus
                    maxLength={60}
                  />
                </div>
                <div className="form-group">
                  <label>규격</label>
                  <input
                    aria-label="규격"
                    type="text"
                    value={addForm.spec}
                    onChange={(e) => setAddForm((f) => ({ ...f, spec: e.target.value }))}
                    placeholder="예) GCP-32ANM 5A 2P"
                    maxLength={120}
                  />
                </div>
              </>
            )}
            <div className="form-group">
              <label>재고 수량</label>
              <input
                aria-label="재고 수량"
                type="number"
                className="num-input"
                value={addForm.stockQty}
                onChange={(e) => setAddForm((f) => ({ ...f, stockQty: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && addForm.name.trim()) submitAdd();
                }}
                placeholder="0"
                style={{ maxWidth: 160 }}
                autoFocus={!!addForm.existingId}
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setNewMode(false);
                  setAddForm((f) => ({ ...f, existingId: '' }));
                }}
              >
                뒤로
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!addForm.name.trim() || adding}
                onClick={submitAdd}
              >
                {adding ? '추가하는 중...' : '추가'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal isOpen={!!historyItem} onClose={() => setHistoryItem(null)} title="재고 조정 이력">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          {historyItem?.name} {historyItem?.spec ? `· ${historyItem.spec}` : ''}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">날짜</th>
              <th scope="col" className="col-num">
                변경
              </th>
              <th scope="col">사유</th>
              <th scope="col">바꾼 사람</th>
            </tr>
          </thead>
          <tbody>
            {[...(historyItem?.stockHistory || [])].reverse().map((h, i) => (
              <tr key={`${h.date}-${i}`}>
                <td data-label="날짜">{h.date}</td>
                <td data-label="변경" className="col-num">
                  {/* 손으로 고친 기록은 '몇→몇', 발주가 오간 기록은 '+N/−N' 으로 남는다 */}
                  {h.delta !== undefined ? (
                    <strong className={h.delta < 0 ? 'stock-delta-out' : 'stock-delta-in'}>
                      {h.delta > 0 ? `+${h.delta}` : h.delta}
                    </strong>
                  ) : (
                    <>
                      {h.from} → <strong>{h.to}</strong>
                    </>
                  )}
                </td>
                <td data-label="사유">{h.reason || '직접 수정'}</td>
                <td data-label="바꾼 사람">{h.byName || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
