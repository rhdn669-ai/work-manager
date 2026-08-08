import { useState, useEffect, useMemo } from 'react';
import { subscribePurchaseItems, setItemStock } from '../../services/purchaseService';
import { useDialog } from '../../components/common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import Skeleton from '../../components/common/Skeleton';
import EmptyState from '../../components/common/EmptyState';
import Select from '../../components/common/Select';

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

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="stock-page">
      <div className="page-header">
        <h2>재고</h2>
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
                <th>단위</th>
                <th>재고</th>
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
                    <td data-label="단위" className="stock-unit">
                      {it.unit || '-'}
                    </td>
                    <td data-label="재고">
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

      <Modal isOpen={!!historyItem} onClose={() => setHistoryItem(null)} title="재고 조정 이력">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          {historyItem?.name} {historyItem?.spec ? `· ${historyItem.spec}` : ''}
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>변경</th>
              <th>바꾼 사람</th>
            </tr>
          </thead>
          <tbody>
            {[...(historyItem?.stockHistory || [])].reverse().map((h, i) => (
              <tr key={`${h.date}-${i}`}>
                <td data-label="날짜">{h.date}</td>
                <td data-label="변경">
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
