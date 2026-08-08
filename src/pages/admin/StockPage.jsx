import { useState, useEffect, useMemo } from 'react';
import { subscribePurchaseItems, setItemStock, addPurchaseItem, nextMainCode } from '../../services/purchaseService';
import { useDialog } from '../../components/common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import Skeleton from '../../components/common/Skeleton';
import EmptyState from '../../components/common/EmptyState';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';

// 재고 — 품목별로 창고에 몇 개 남았는지 손으로 적어 두는 곳.
// 발주해도 자동으로 줄지 않는다. 자재를 꺼내 쓴 뒤에는 여기서 직접 고쳐야 한다.
// 여기 적힌 수량만큼 발주서 작성 때 발주 수량에서 빠진다.

const FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'has', label: '재고 있는 것만' },
  { value: 'none', label: '재고 없는 것만' },
];

function fmtWhen(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function StockPage() {
  const { toast } = useDialog();
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
  const [addForm, setAddForm] = useState({ code: '', name: '', spec: '', unit: '', stockQty: '' });
  const [adding, setAdding] = useState(false);

  useEffect(
    () =>
      subscribePurchaseItems((list) => {
        setItems(list);
        setLoading(false);
      }),
    [],
  );

  const shown = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter((it) => {
      const stock = Number(it.stockQty) || 0;
      if (filter === 'has' && stock <= 0) return false;
      if (filter === 'none' && stock > 0) return false;
      if (!kw) return true;
      return [it.code, it.name, it.spec, it.maker, it.category].some((v) => (v || '').toLowerCase().includes(kw));
    });
  }, [items, search, filter]);

  const summary = useMemo(() => {
    const withStock = items.filter((it) => (Number(it.stockQty) || 0) > 0);
    return {
      kinds: withStock.length,
      total: withStock.reduce((s, it) => s + (Number(it.stockQty) || 0), 0),
    };
  }, [items]);

  async function commit(it) {
    const raw = edit[it.id];
    if (raw === undefined) return;
    setEdit((p) => {
      const n = { ...p };
      delete n[it.id];
      return n;
    });
    const from = Number(it.stockQty) || 0;
    const to = Math.max(0, Number(raw) || 0);
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
  function openAdd() {
    setAddForm({ code: nextMainCode(items), name: '', spec: '', unit: '', stockQty: '' });
    setAddOpen(true);
  }

  async function submitAdd() {
    const name = addForm.name.trim();
    if (!name) return;
    const dup = items.find((it) => (it.name || '').trim() === name && (it.spec || '').trim() === addForm.spec.trim());
    if (dup) {
      toast('같은 품명·규격의 품목이 이미 있습니다', 'error');
      return;
    }
    setAdding(true);
    try {
      await addPurchaseItem({
        code: addForm.code.trim(),
        name,
        spec: addForm.spec.trim(),
        unit: addForm.unit.trim(),
        stockQty: Math.max(0, Number(addForm.stockQty) || 0),
      });
      setAddOpen(false);
      toast(`"${name}"을(를) 품목에 추가했습니다`, 'success');
    } catch {
      toast('항목 추가 중 오류가 발생했습니다', 'error');
    } finally {
      setAdding(false);
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
        </div>
      </div>

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
          title={items.length === 0 ? '등록된 품목이 없습니다' : '해당 조건의 품목이 없습니다'}
          desc={items.length === 0 ? '품목 탭에서 품목을 먼저 등록하세요.' : '검색어나 필터를 바꿔 보세요.'}
        />
      ) : (
        <div className="table-scroll-x">
          <table className="table cards-sm stock-table">
            <colgroup>
              <col style={{ width: '13%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '29%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>코드</th>
                <th>품명</th>
                <th>규격</th>
                <th className="col-unit">단위</th>
                <th className="col-num">재고</th>
                <th className="col-action">최근 조정</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => {
                const stock = Number(it.stockQty) || 0;
                const value = edit[it.id] !== undefined ? edit[it.id] : String(stock);
                const hist = Array.isArray(it.stockHistory) ? it.stockHistory : [];
                return (
                  <tr key={it.id} className={stock > 0 ? 'stock-row-has' : undefined}>
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
                        min="0"
                        className="num-input stock-input"
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
        <p className="field-hint" style={{ marginBottom: 12 }}>
          품목 탭에 없는 자재를 여기서 바로 만듭니다. 만든 항목은 <strong>품목 목록에도 함께 등록</strong>되어, 발주서를
          쓸 때 재고만큼 자동으로 빠집니다.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>코드</label>
            <input
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
            type="text"
            value={addForm.spec}
            onChange={(e) => setAddForm((f) => ({ ...f, spec: e.target.value }))}
            placeholder="예) GCP-32ANM 5A 2P"
            maxLength={120}
          />
        </div>
        <div className="form-group">
          <label>재고 수량</label>
          <input
            type="number"
            min="0"
            className="num-input"
            value={addForm.stockQty}
            onChange={(e) => setAddForm((f) => ({ ...f, stockQty: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && addForm.name.trim()) submitAdd();
            }}
            placeholder="0"
            style={{ maxWidth: 160 }}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setAddOpen(false)}>
            취소
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
      </Modal>

      <Modal isOpen={!!historyItem} onClose={() => setHistoryItem(null)} title="재고 조정 이력">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          {historyItem?.name} {historyItem?.spec ? `· ${historyItem.spec}` : ''}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>날짜</th>
              <th className="col-num">변경</th>
              <th>바꾼 사람</th>
            </tr>
          </thead>
          <tbody>
            {[...(historyItem?.stockHistory || [])].reverse().map((h, i) => (
              <tr key={`${h.date}-${i}`}>
                <td data-label="날짜">{h.date}</td>
                <td data-label="변경" className="col-num">
                  {h.from} → <strong>{h.to}</strong>
                </td>
                <td data-label="바꾼 사람">{h.byName || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </div>
  );
}
