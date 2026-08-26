import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import Select from '../../components/common/Select';
import Skeleton from '../../components/common/Skeleton';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import EmptyState from '../../components/common/EmptyState';
import TrashModal from '../../components/common/TrashModal';
import { getAllSites, getFinanceItems } from '../../services/siteService';
import { getPurchases, getSuppliers, subscribePurchaseItems } from '../../services/purchaseService';
import {
  getMonthClosing,
  getManualItems,
  addManualItem,
  trashManualItem,
  setRowConfirm,
  lockMonth,
  unlockMonth,
} from '../../services/marginClosingService';
import {
  receivedRowsOf,
  groupByVendor,
  payMonthLabel,
  revenueRows,
  applyConfirm,
  sumRows,
  groupState,
} from '../../domain/marginClosing';
import '../../styles/margin-closing.css';

const won = (n) => (Number(n) || 0).toLocaleString();

// 마감 리스트 — 그달 매출과 업체에 줄 돈을 건별로 펼쳐 대표님이 금액을 확정하는 화면.
// 확정한 것만 합계에 들어간다. 총 마감 숫자를 믿을 수 있게 만드는 근거 화면이다.
export default function MarginClosingPage() {
  const { canApproveAll, userProfile } = useAuth();
  const { toast, confirm } = useDialog();
  const me = userProfile?.name || '';
  const now = new Date();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlY = Number(searchParams.get('y'));
  const urlM = Number(searchParams.get('m'));
  const year = urlY >= 2024 && urlY <= 2030 ? urlY : now.getFullYear();
  const month = urlM >= 1 && urlM <= 12 ? urlM : now.getMonth() + 1;
  const setYM = (y, m) => {
    const next = new URLSearchParams(searchParams);
    next.set('y', String(y));
    next.set('m', String(m));
    setSearchParams(next);
  };

  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [sites, setSites] = useState([]);
  const [financesBySite, setFinancesBySite] = useState({});
  const [confirms, setConfirms] = useState({});
  const [locked, setLocked] = useState(false);
  const [lockedBy, setLockedBy] = useState('');
  const [manual, setManual] = useState([]);
  const [editing, setEditing] = useState(null); // { key, value }
  const [adding, setAdding] = useState(null); // { kind, ... }
  const [openVendors, setOpenVendors] = useState(() => new Set()); // 펼쳐 둔 업체 폴더
  const [tab, setTab] = useState('expense'); // 'expense' | 'revenue' — 지출을 먼저 본다(업체에 줄 돈)
  const [trashOpen, setTrashOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const loadClosing = useCallback(async () => {
    const [mc, mi] = await Promise.all([getMonthClosing(year, month), getManualItems(year, month)]);
    setConfirms(mc.confirms);
    setLocked(mc.locked);
    setLockedBy(mc.lockedBy);
    setManual(mi);
  }, [year, month]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [ps, sp, st] = await Promise.all([getPurchases(), getSuppliers(), getAllSites()]);
        if (cancelled) return;
        setPurchases(ps);
        setSuppliers(sp);
        setSites(st);
        // 매출은 현장별 마감에 적힌 것을 그대로 가져온다 — 총 마감과 같은 소스라야 숫자가 어긋나지 않는다.
        const fin = await Promise.all(st.map((s) => getFinanceItems(s.id, year, month)));
        if (cancelled) return;
        setFinancesBySite(Object.fromEntries(st.map((s, i) => [s.id, fin[i]])));
        await loadClosing();
      } catch (err) {
        console.error(err);
        toast('마감 자료를 불러오지 못했습니다', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, month, loadClosing, toast]);

  useEffect(() => subscribePurchaseItems(setItemMaster), []);

  // ── 매출: 현장별 / 지출: 업체별 ──────────────────────────
  const revenue = useMemo(() => {
    const auto = revenueRows(sites, financesBySite);
    const hand = manual
      .filter((m) => m.kind === 'revenue')
      .map((m) => ({
        key: `manual:${m.id}`,
        manualId: m.id,
        siteName: m.siteName || '(현장 없음)',
        description: m.description || '(내역 없음)',
        amount: Number(m.amount) || 0,
        manual: true,
      }));
    // 매출은 마감 절차가 없어 미확정으로 시작한다 — 대표님이 한 건씩 확인해야 합계에 든다.
    return applyConfirm([...auto, ...hand], confirms);
  }, [sites, financesBySite, manual, confirms]);

  const expense = useMemo(() => {
    // 그달 입고 확정된 건은 전부 올라온다 — 마감 버튼을 눌렀든 안 눌렀든.
    // 누르는 걸 잊어 통째로 빠지는 일이 없어야 한다 (2026-08-26 대표님).
    const rows = purchases
      .flatMap((p) => receivedRowsOf(p, itemMaster, suppliers, year, month))
      .map((r) => ({ ...r, payMonth: payMonthLabel(r.payDue) }));
    const hand = manual
      .filter((m) => m.kind !== 'revenue')
      .map((m) => ({
        key: `manual:${m.id}`,
        manualId: m.id,
        vendor: m.vendor || '(업체 없음)',
        siteName: m.siteName || '(현장 없음)',
        description: m.description || '(내역 없음)',
        amount: Number(m.amount) || 0,
        payMonth: m.payMonth || '',
        manual: true,
      }));
    // 발주서에서 마감한 건만 확정으로 선다. 입고만 되고 마감을 안 누른 건은 미확정 —
    // 노란 줄로 떠서 「아직 손 안 댄 것」이 한눈에 보인다.
    const all = [
      ...rows.map((r) => applyConfirm([r], confirms, { defaultConfirmed: !!r.closed })[0]),
      ...applyConfirm(hand, confirms, { defaultConfirmed: true }),
    ];
    return groupByVendor(all);
  }, [purchases, itemMaster, suppliers, year, month, manual, confirms]);

  const expenseRows = useMemo(() => expense.flatMap((g) => g.lines), [expense]);
  const revSum = useMemo(() => sumRows(revenue), [revenue]);
  const expSum = useMemo(() => sumRows(expenseRows), [expenseRows]);
  const totalCount = revSum.count + expSum.count;
  const doneCount = revSum.confirmedCount + expSum.confirmedCount;
  const leftCount = totalCount - doneCount;

  // ── 확정·금액 수정 ──────────────────────────────────────
  async function toggleConfirm(row) {
    if (locked) return toast('마감된 달입니다. 잠금을 풀어야 고칠 수 있습니다', 'error');
    setBusy(row.key);
    try {
      await setRowConfirm(year, month, row.key, {
        amount: row.edited ? row.amount : undefined,
        confirmed: !row.confirmed,
        by: me,
      });
      await loadClosing();
    } catch (err) {
      console.error(err);
      toast('확정에 실패했습니다', 'error');
    } finally {
      setBusy('');
    }
  }

  async function saveAmount(row, value) {
    setEditing(null);
    const next = Number(String(value).replace(/[^0-9-]/g, ''));
    if (!Number.isFinite(next) || next === row.amount) return;
    try {
      await setRowConfirm(year, month, row.key, { amount: next, confirmed: row.confirmed, by: me });
      await loadClosing();
    } catch (err) {
      console.error(err);
      toast('금액을 저장하지 못했습니다', 'error');
    }
  }

  async function onLock() {
    if (locked) {
      if (!(await confirm(`${month}월 마감을 풀까요? 다시 고칠 수 있게 됩니다.`))) return;
      await unlockMonth(year, month);
      await loadClosing();
      return toast(`${month}월 마감을 풀었습니다`, 'success');
    }
    const msg =
      leftCount > 0
        ? `미확정 ${leftCount}건이 합계에서 빠진 채로 마감됩니다. 그대로 진행할까요?`
        : `${month}월을 마감할까요? 숫자가 고정됩니다.`;
    if (!(await confirm(msg))) return;
    await lockMonth(year, month, me);
    await loadClosing();
    toast(`${month}월 마감을 완료했습니다`, 'success', 0);
  }

  async function onAdd(e) {
    e.preventDefault();
    const f = adding;
    if (!f.description.trim() || !Number(f.amount)) return toast('내역과 금액을 적어 주세요', 'error');
    try {
      await addManualItem(year, month, { ...f, createdBy: me });
      setAdding(null);
      await loadClosing();
      toast('항목을 추가했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('추가에 실패했습니다', 'error');
    }
  }

  async function onTrash(row) {
    if (!(await confirm('이 항목을 휴지통으로 보낼까요?'))) return;
    try {
      await trashManualItem(row.manualId, me);
      await loadClosing();
      toast('휴지통으로 보냈습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('삭제에 실패했습니다', 'error');
    }
  }

  if (!canApproveAll) {
    return (
      <div className="card">
        <div className="card-body empty-state">접근 권한이 없습니다.</div>
      </div>
    );
  }

  const amountCell = (row) => (
    <td className="col-num mc-amt-cell">
      {editing?.key === row.key ? (
        <input
          className="mc-amt-input"
          autoFocus
          defaultValue={row.amount}
          onBlur={(e) => saveAmount(row, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setEditing(null);
          }}
          aria-label="금액"
        />
      ) : (
        <button
          type="button"
          className={`mc-amt${row.edited ? ' is-edited' : ''}`}
          onClick={() => !locked && setEditing({ key: row.key })}
          title={row.edited ? `자동 계산 ${won(row.autoAmount)}원` : '눌러서 고치기'}
        >
          {won(row.amount)}
        </button>
      )}
    </td>
  );

  const confirmCell = (row) => (
    <td className="col-action">
      <div className="row-actions">
        {row.manual && (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => onTrash(row)} disabled={locked}>
            <Icon name="trash" className="btn-ic" />
            삭제
          </button>
        )}
        <button
          type="button"
          className={`mc-chip ${row.confirmed ? 'is-done' : 'is-todo'}`}
          onClick={() => toggleConfirm(row)}
          disabled={locked || busy === row.key}
        >
          {row.confirmed ? '확정' : '미확정'}
        </button>
      </div>
    </td>
  );

  return (
    <div className="margin-closing-page">
      {/* 매출·지출 탭 (제목 위 — 상단 탭 표준) */}
      <div className="tab-nav" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'expense' ? 'active' : ''}`}
          onClick={() => setTab('expense')}
        >
          지출{expSum.count > 0 && <span className="tab-nav-count">{expSum.count}</span>}
        </button>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'revenue' ? 'active' : ''}`}
          onClick={() => setTab('revenue')}
        >
          매출{revSum.count > 0 && <span className="tab-nav-count">{revSum.count}</span>}
        </button>
      </div>

      <div className="page-header">
        <h2>마감 리스트</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() =>
              setAdding({ kind: tab, vendor: '', siteName: '', description: '', amount: '', payMonth: '' })
            }
            disabled={locked}
          >
            <Icon name="plus" className="btn-ic" />
            항목 추가
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={onLock}>
            <Icon name={locked ? 'unlock' : 'check'} className="btn-ic" />
            {locked ? `${month}월 마감 풀기` : `${month}월 마감 완료`}
          </button>
        </div>
      </div>

      <div className="filters">
        <Select
          value={year}
          onChange={(v) => setYM(Number(v), month)}
          options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: `${y}년` }))}
          ariaLabel="연도 선택"
        />
        <Select
          value={month}
          onChange={(v) => setYM(year, Number(v))}
          options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` }))}
          ariaLabel="월 선택"
        />
        {locked && (
          <span className="mc-locked-tag">
            <Icon name="lock" /> 마감됨{lockedBy ? ` · ${lockedBy}` : ''}
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton.Rows count={8} />
      ) : (
        <>
          <div className="sum-cards">
            <div className="sum-card">
              <div className="sum-card-label">매출</div>
              <div className="sum-card-value">
                {won(revSum.confirmed)}
                <em>원</em>
              </div>
              <div className="sum-card-sub">
                확정 {revSum.confirmedCount}건{revSum.pendingCount > 0 && <b> · 미확정 {revSum.pendingCount}건</b>}
              </div>
            </div>
            <div className="sum-card">
              <div className="sum-card-label">
                지출 <span className="sum-card-note">업체 결제분</span>
              </div>
              <div className="sum-card-value">
                {won(expSum.confirmed)}
                <em>원</em>
              </div>
              <div className="sum-card-sub">
                업체 {expense.length}곳{expSum.pendingCount > 0 && <b> · 미확정 {expSum.pendingCount}건</b>}
              </div>
            </div>
            <div className="sum-card is-good">
              <div className="sum-card-label">차액</div>
              <div className="sum-card-value">
                {won(revSum.confirmed - expSum.confirmed)}
                <em>원</em>
              </div>
              <div className="sum-card-sub">
                {leftCount > 0 ? `미확정 ${leftCount}건이 빠진 금액입니다` : '모두 확정되었습니다'}
              </div>
            </div>
          </div>

          <div className="sum-prog">
            <div className="sum-prog-text">
              {totalCount}건 중 <b>{doneCount}건</b> 확정
            </div>
            <div className="sum-prog-bar">
              <i style={{ width: `${totalCount ? Math.round((doneCount / totalCount) * 100) : 0}%` }} />
            </div>
            <div className="sum-prog-left">남은 {leftCount}건</div>
          </div>

          {/* 매출 — 현장이 곧 고객사라 현장별로 본다 */}
          <section className="mc-sec" hidden={tab !== 'revenue'}>
            <div className="mc-sec-head">
              <h3>매출</h3>
              <span className="mc-sec-n">{revSum.count}건</span>
              <div className="mc-sec-sp" />
              <div className="mc-sec-total">{won(revSum.confirmed)}</div>
            </div>
            {revenue.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="이 달 매출이 없습니다"
                desc="현장 마감에 매출을 적으면 여기 올라옵니다."
              />
            ) : (
              <div className="table-scroll-x">
                <table className="table mc-table">
                  <thead>
                    <tr>
                      <th style={{ width: 200 }}>현장</th>
                      <th>내역</th>
                      <th className="col-unit" style={{ width: 100 }}>
                        출처
                      </th>
                      <th className="col-num" style={{ width: 220 }}>
                        금액
                      </th>
                      <th className="col-action">확정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.map((r) => (
                      <tr key={r.key} className={r.confirmed ? '' : 'is-todo'}>
                        <td className="mc-site">{r.siteName}</td>
                        <td className="mc-desc">{r.description}</td>
                        <td className="col-unit">
                          <span className="mc-src">{r.manual ? '직접입력' : '자동'}</span>
                        </td>
                        {amountCell(r)}
                        {confirmCell(r)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 지출 — 결제할 업체로 묶는다 */}
          <section className="mc-sec" hidden={tab !== 'expense'}>
            <div className="mc-sec-head">
              <h3>지출</h3>
              <span className="mc-sec-n">업체에 줄 돈 · {expSum.count}건</span>
              <div className="mc-sec-sp" />
              <div className="mc-sec-total">{won(expSum.confirmed)}</div>
            </div>
            {expenseRows.length === 0 ? (
              <EmptyState
                icon="inbox"
                title="이 달 업체 결제분이 없습니다"
                desc="그달에 입고 확정된 발주가 있으면 업체별로 올라옵니다."
              />
            ) : (
              <div className="payment-folders mc-folders">
                {expense.map((g) => {
                  const st = groupState(g.lines);
                  const open = openVendors.has(g.vendor);
                  const todo = g.lines.filter((l) => !l.confirmed).length;
                  return (
                    <div
                      key={g.vendor}
                      className={`payment-folder${open ? ' is-open' : ''}${st === 'confirmed' ? ' is-paid' : ''}`}
                    >
                      <button
                        type="button"
                        className="payment-folder-head"
                        onClick={() =>
                          setOpenVendors((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.vendor)) next.delete(g.vendor);
                            else next.add(g.vendor);
                            return next;
                          })
                        }
                      >
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} className="payment-folder-caret" />
                        <Icon name="building" className="payment-folder-ic" />
                        <span className="payment-folder-title" title={g.vendor}>
                          {g.vendor}
                        </span>
                        <span className="payment-folder-site">{g.lines.length}건</span>
                        <span className="payment-folder-spacer" />
                        {todo > 0 && <span className="payment-folder-badge">미확정 {todo}</span>}
                        {todo === 0 && <span className="payment-folder-badge is-done">확정</span>}
                        <span className="payment-folder-amount">{won(g.total)}원</span>
                      </button>

                      {open && (
                        <div className="payment-folder-body table-scroll-x">
                          <table className="table mc-table">
                            <thead>
                              <tr>
                                <th style={{ width: 200 }}>현장</th>
                                <th>내역</th>
                                <th className="col-unit" style={{ width: 100 }}>
                                  출처
                                </th>
                                <th className="col-unit" style={{ width: 100 }}>
                                  결제 예정
                                </th>
                                <th className="col-num" style={{ width: 200 }}>
                                  금액
                                </th>
                                <th className="col-action">확정</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.lines.map((r) => (
                                <tr key={r.key} className={r.confirmed ? '' : 'is-todo'}>
                                  <td className="mc-site">{r.siteName}</td>
                                  <td className="mc-desc">{r.description}</td>
                                  <td className="col-unit">
                                    <span className="mc-src">{r.manual ? '직접입력' : '자동'}</span>
                                  </td>
                                  <td className="col-unit">
                                    {r.payMonth ? <span className="mc-when">{r.payMonth}</span> : ''}
                                  </td>
                                  {amountCell(r)}
                                  {confirmCell(r)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <p className="mc-note">
            <b>지출은 발주서에서 「마감」을 누른 건이 올라옵니다.</b> 담당자가 그달 납품받은 금액을 정한 것이라 확정
            상태로 들어오고, 대표님은 이상한 것만 금액을 눌러 고치시면 됩니다. 업체에 줄 돈만 담습니다 — 잔업
            수당·고정비는 총 마감에서 봅니다. 결제가 다음 달이어도 납품이 이번 달이면 이번 달에 잡히고, 업체별 결제
            조건으로 계산한 달이 「결제 예정」에 표시됩니다.
            <br />
            <b>매출은 미확정으로 올라옵니다</b> — 한 건씩 확인해 주셔야 합계에 들어갑니다.
          </p>
        </>
      )}

      {adding && (
        <Modal isOpen onClose={() => setAdding(null)} title="항목 추가">
          <form onSubmit={onAdd} className="form-grid">
            <div className="form-field">
              <label>구분</label>
              <Select
                value={adding.kind}
                onChange={(v) => setAdding((s) => ({ ...s, kind: v }))}
                options={[
                  { value: 'expense', label: '지출 (업체에 줄 돈)' },
                  { value: 'revenue', label: '매출' },
                ]}
                ariaLabel="구분"
              />
            </div>
            {adding.kind === 'expense' && (
              <div className="form-field">
                <label>업체</label>
                <input
                  value={adding.vendor}
                  onChange={(e) => setAdding((s) => ({ ...s, vendor: e.target.value }))}
                  placeholder="결제할 업체 이름"
                />
              </div>
            )}
            <div className="form-field">
              <label>현장</label>
              <input
                value={adding.siteName}
                onChange={(e) => setAdding((s) => ({ ...s, siteName: e.target.value }))}
                placeholder="프로젝트 이름"
              />
            </div>
            <div className="form-field">
              <label>내역</label>
              <input
                value={adding.description}
                onChange={(e) => setAdding((s) => ({ ...s, description: e.target.value }))}
                placeholder="무엇에 대한 돈인지"
              />
            </div>
            <div className="form-field">
              <label>금액</label>
              <input
                value={adding.amount}
                onChange={(e) => setAdding((s) => ({ ...s, amount: e.target.value.replace(/[^0-9]/g, '') }))}
                inputMode="numeric"
                placeholder="0"
              />
            </div>
            {adding.kind === 'expense' && (
              <div className="form-field">
                <label>결제 예정</label>
                <input
                  value={adding.payMonth}
                  onChange={(e) => setAdding((s) => ({ ...s, payMonth: e.target.value }))}
                  placeholder="예: 9월"
                />
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setAdding(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                추가
              </button>
            </div>
          </form>
        </Modal>
      )}

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['marginClosingItems']}
        title="마감 리스트 휴지통"
        onChange={loadClosing}
      />
    </div>
  );
}
