// 사급 재고 — 고객사가 호기를 정하지 않고 보내온 물건을 모아 두는 곳. (2026-09-10 대표님)
//
// 들어오면 수량이 «더해지고», 호기 자재 체크에서 「재고에서 N」으로 가져가면 줄어든다.
// 창고 재고(우리가 산 물건)와는 다른 곳이다 — 회사별로 따로 센다.
import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import Modal from '../../components/common/Modal';
import Select from '../../components/common/Select';
import EditModeButton from '../../components/common/EditModeButton';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { subscribeFreeStock, receiveFreeStock, setFreeStockQty } from '../../services/freeStockService';

const won = (n) => (Number(n) || 0).toLocaleString();

export default function FreeStockPage({ company }) {
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();
  const me = userProfile?.name || '';

  const [master, setMaster] = useState([]);
  const [stock, setStock] = useState({});
  const [q, setQ] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [adding, setAdding] = useState(null); // { itemId, qty, note }
  const [fixing, setFixing] = useState(null); // { row, to, reason }

  useEffect(() => subscribePurchaseItems(setMaster), []);
  useEffect(() => subscribeFreeStock(company, setStock), [company]);

  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  const itemOptions = useMemo(
    () =>
      master
        .map((m) => ({
          value: m.id,
          label: [m.code, m.name, m.spec].filter(Boolean).join(' · '),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [master],
  );

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return Object.values(stock)
      .map((s) => {
        const m = masterMap[s.itemId] || {};
        return {
          ...s,
          code: s.code || m.code || '',
          name: s.name || m.name || '',
          spec: s.spec || m.spec || '',
          drawingNo: m.drawingNo || '',
          lastAt: (s.log || []).at(-1)?.at || '',
        };
      })
      .filter((r) => {
        if (!kw) return true;
        return [r.code, r.name, r.spec, r.drawingNo].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(kw),
        );
      })
      .sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  }, [stock, masterMap, q]);

  const total = rows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const kinds = rows.filter((r) => (Number(r.qty) || 0) > 0).length;

  async function onAdd(e) {
    e.preventDefault();
    const f = adding;
    const n = Number(f.qty) || 0;
    if (!f.itemId) return toast('품목을 고르세요', 'error');
    if (n <= 0) return toast('수량을 적어 주세요', 'error');
    const m = masterMap[f.itemId] || {};
    try {
      await receiveFreeStock(company, { itemId: f.itemId, code: m.code, name: m.name, spec: m.spec, unit: m.unit }, n, {
        by: me,
        note: f.note || '',
      });
      setAdding(null);
      toast(`${m.name || m.code} ${n}개 들어왔습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('저장에 실패했습니다', 'error');
    }
  }

  async function onFix(e) {
    e.preventDefault();
    const { row, to, reason } = fixing;
    const t = Number(to) || 0;
    if (t === Number(row.qty)) return setFixing(null);
    if (!(await confirm(`${row.name || row.code} 재고를 ${won(row.qty)} → ${won(t)} 으로 고칠까요?`))) return;
    try {
      await setFreeStockQty(company, row, t, { by: me, reason });
      setFixing(null);
      toast('재고를 고쳤습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('고치기에 실패했습니다', 'error');
    }
  }

  return (
    <div className="fstock">
      <div className="fstock-head no-print">
        <div className="fstock-sums">
          <span className="fstock-sum">
            품목 <b>{kinds}</b>
          </span>
          <span className="fstock-sum">
            총 수량 <b>{won(total)}</b>
          </span>
        </div>
        <input
          className="fstock-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="도번·품명·규격으로 찾기"
          aria-label="사급 재고 검색"
        />
        <div className="fstock-acts">
          <EditModeButton on={editMode} onToggle={() => setEditMode((v) => !v)} />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setAdding({ itemId: '', qty: '', note: '' })}
          >
            <Icon name="plus" className="btn-ic" />
            사급 받기
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{company} 사급 재고가 없습니다</p>
          <span>물건이 들어오면 「사급 받기」로 적어 두세요. 호기에서 필요할 때 가져다 씁니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x no-print">
          <table className="table pmat-table">
            <colgroup>
              {['44px', '15%', '14%', null, '10%', '14%', editMode ? '10%' : null].map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="col-no">
                  No
                </th>
                <th scope="col">도번</th>
                <th scope="col">품명</th>
                <th scope="col">규격</th>
                <th scope="col" className="col-num">
                  재고
                </th>
                <th scope="col">최근 기록</th>
                {editMode && (
                  <th scope="col" className="col-action">
                    작업
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const last = (r.log || []).at(-1);
                return (
                  <tr key={r.id} className={Number(r.qty) > 0 ? '' : 'is-skipped'}>
                    <td className="col-no">{i + 1}</td>
                    <td className="pmat-drawing">{r.drawingNo}</td>
                    <td className="u-wrap">{r.name}</td>
                    <td className="pmat-spec u-wrap" title={r.spec}>
                      {r.spec}
                    </td>
                    <td className="col-num">
                      <b>{won(r.qty)}</b>
                    </td>
                    <td className="pmat-meta">
                      {last
                        ? `${String(last.at).slice(0, 10)} · ${
                            last.kind === 'in'
                              ? '들어옴'
                              : last.kind === 'out'
                                ? '호기로'
                                : last.kind === 'back'
                                  ? '되돌림'
                                  : '정정'
                          } ${won(last.n)}${last.by ? ` · ${last.by}` : ''}`
                        : ''}
                    </td>
                    {editMode && (
                      <td className="col-action">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => setFixing({ row: r, to: String(r.qty || 0), reason: '' })}
                        >
                          수량 고치기
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal isOpen onClose={() => setAdding(null)} title={`${company} 사급 받기`}>
          <form onSubmit={onAdd}>
            <div className="form-group">
              <label>품목</label>
              <Select
                value={adding.itemId}
                onChange={(v) => setAdding((s) => ({ ...s, itemId: v }))}
                options={itemOptions}
                placeholder="품목 고르기"
                ariaLabel="품목"
              />
            </div>
            <div className="form-group">
              <label>받은 수량</label>
              <input
                value={adding.qty}
                onChange={(e) => setAdding((s) => ({ ...s, qty: e.target.value.replace(/[^0-9]/g, '') }))}
                inputMode="numeric"
                placeholder="0"
                aria-label="받은 수량"
              />
            </div>
            <div className="form-group">
              <label>메모</label>
              <input
                value={adding.note}
                onChange={(e) => setAdding((s) => ({ ...s, note: e.target.value }))}
                placeholder="어디서 왔는지 등 (선택)"
                aria-label="메모"
              />
            </div>
            <p className="field-hint">이미 있는 품목이면 지금 수량에 더해집니다.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setAdding(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                받기
              </button>
            </div>
          </form>
        </Modal>
      )}

      {fixing && (
        <Modal isOpen onClose={() => setFixing(null)} title="재고 수량 고치기">
          <form onSubmit={onFix}>
            <p className="field-hint" style={{ marginTop: 0 }}>
              <strong>{fixing.row.name || fixing.row.code}</strong> · 지금 {won(fixing.row.qty)}
            </p>
            <div className="form-group">
              <label>실제 수량</label>
              <input
                value={fixing.to}
                onChange={(e) => setFixing((s) => ({ ...s, to: e.target.value.replace(/[^0-9]/g, '') }))}
                inputMode="numeric"
                aria-label="실제 수량"
              />
            </div>
            <div className="form-group">
              <label>이유</label>
              <input
                value={fixing.reason}
                onChange={(e) => setFixing((s) => ({ ...s, reason: e.target.value }))}
                placeholder="세어 보니 다름 등"
                aria-label="이유"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setFixing(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                고치기
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
