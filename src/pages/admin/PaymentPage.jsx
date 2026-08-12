import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import Icon from '../../components/common/Icon';
import Modal from '../../components/common/Modal';
import {
  getPurchases,
  getSuppliers,
  subscribePurchaseItems,
  markSupplierPaid,
  unmarkSupplierPaid,
  setSupplierTaxInvoice,
} from '../../services/purchaseService';
import { getSupplierLibraryFiles } from '../../services/fileLibraryService';
import { mapPrintItems, computeSupplierList } from '../../utils/purchaseOrder';

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function ms(ts) {
  if (!ts) return 0;
  return ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
}
// 타임스탬프 → 'YYYY.MM' (년월 필터 키)
function monthKey(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 발주완료(업체 발송)된 건이 자동으로 올라오는 결제 페이지.
// 대표가 여기서 결제 대기 → 결제 완료 처리.
export default function PaymentPage() {
  const navigate = useNavigate();
  const { confirm, toast } = useDialog();
  const { userProfile } = useAuth();
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('pending'); // 'pending' | 'paid' | 'all'
  const [monthFilter, setMonthFilter] = useState(() => monthKey(new Date())); // 기본: 현재 월 (결제요청일 기준)
  const [expanded, setExpanded] = useState(() => new Set()); // 펼친 폴더 키
  // 묶는 기준 — 발주서(프로젝트)별 / 업체별 / 일자별(결제 마감일) (2026-08-03 대표님)
  const [groupBy, setGroupBy] = useState('project');
  const [busy, setBusy] = useState('');
  // 사업자등록증 모달 { supplier, loading, files }
  const [bizDoc, setBizDoc] = useState(null);

  async function openBizDoc(supplier) {
    setBizDoc({ supplier, loading: true, files: [] });
    try {
      const files = await getSupplierLibraryFiles(supplier);
      setBizDoc({ supplier, loading: false, files });
    } catch (err) {
      console.error(err);
      setBizDoc({ supplier, loading: false, files: [], error: err.message || String(err) });
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, sp] = await Promise.all([getPurchases(), getSuppliers()]);
      setPurchases(ps);
      setSuppliers(sp);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = subscribePurchaseItems(setItemMaster);
    return () => unsub();
  }, [load]);

  // 구매처명 → 사업자번호·은행·계좌 조회용 맵
  const supByName = useMemo(() => {
    const m = new Map();
    for (const s of suppliers) {
      if (s.name) m.set(s.name, s);
    }
    return m;
  }, [suppliers]);

  // 결제 요청된(paymentRequested) (발주 × 업체) 건을 모두 모은다 — 결제 대상.
  const allRows = useMemo(() => {
    const out = [];
    for (const p of purchases) {
      const reqMap = p.paymentRequested;
      if (!reqMap || Object.keys(reqMap).length === 0) continue;
      const lines = mapPrintItems(p.items || [], itemMaster, suppliers);
      const supList = computeSupplierList(p.items || [], itemMaster, suppliers, p);
      for (const sup of supList) {
        const key = sup.name.replace(/\./g, '_');
        const req = reqMap[key];
        if (!req) continue; // 결제 요청된 업체만
        const paid = p.supplierPaid?.[key];
        const supInfo = supByName.get(sup.name) || {};
        // 결제로 넘어오는 돈은 실제로 들어온 만큼이다. 아직 안 들어온 품목은 빠진다.
        // (입고 전에는 발주 수량으로 잡아 금액이 0 원으로 보이지 않게 한다)
        const mine = lines.filter((l) => (l._supplier || '(구매처 미지정)') === sup.name);
        const anyReceived = mine.some((l) => Number(l.receivedQty) > 0);
        const supply = mine.reduce((s, l) => {
          const qty = Number(l.qty) || 0;
          const got = Math.min(Number(l.receivedQty) || 0, qty); // 초과 입고는 발주 수량까지만
          return s + (anyReceived ? got : qty) * (Number(l.unitPrice) || 0);
        }, 0);
        const ordered = mine.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
        const pendingAmount = ordered - supply; // 아직 안 들어온 몫
        const pendingCount = anyReceived
          ? mine.filter((l) => (Number(l.qty) || 0) - Math.min(Number(l.receivedQty) || 0, Number(l.qty) || 0) > 0)
              .length
          : 0;
        const vat = Math.round(supply * 0.1);
        out.push({
          purchaseId: p.id,
          title: p.title || '(제목 없음)',
          siteName: p.siteName || '',
          supplier: sup.name,
          representative: supInfo.representative || '',
          contact: supInfo.contact || '',
          email: supInfo.email || '',
          businessNumber: supInfo.businessNumber || '',
          bankName: supInfo.bankName || '',
          bankAccount: supInfo.bankAccount || '',
          category: supInfo.category || '',
          note: supInfo.note || '',
          taxInvoice: p.taxInvoice?.[key] || null,
          supply,
          total: supply + vat,
          pendingAmount,
          pendingCount,
          requestedAt: req.requestedAt,
          dueDate: req.dueDate || '',
          paid: !!paid,
          paidAt: paid?.paidAt,
          paidBy: paid?.paidBy || '',
        });
      }
    }
    out.sort((a, b) => ms(b.requestedAt) - ms(a.requestedAt));
    return out;
  }, [purchases, itemMaster, suppliers, supByName]);

  const pendingCount = allRows.filter((r) => !r.paid).length;
  const paidCount = allRows.filter((r) => r.paid).length;

  // 년월 드롭다운 옵션 — 결제요청일 기준, 최신순
  const monthOptions = useMemo(() => {
    const set = new Set();
    set.add(monthKey(new Date())); // 현재 월은 데이터가 없어도 항상 선택 가능
    for (const r of allRows) {
      const m = monthKey(r.dueDate); // 결제마감일 기준
      if (m) set.add(m);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [allRows]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (filterMode === 'pending' && r.paid) return false;
      if (filterMode === 'paid' && !r.paid) return false;
      if (monthFilter !== 'all' && monthKey(r.dueDate) !== monthFilter) return false; // 결제마감월 기준
      if (
        kw &&
        !(
          r.title.toLowerCase().includes(kw) ||
          r.supplier.toLowerCase().includes(kw) ||
          (r.siteName || '').toLowerCase().includes(kw)
        )
      )
        return false;
      return true;
    });
  }, [allRows, filterMode, monthFilter, search]);

  const sumTotal = filtered.reduce((s, r) => s + r.total, 0);
  // 끝난 돈·남은 돈·아직 안 들어온 몫을 한 줄에서 본다
  const paidRows = filtered.filter((r) => r.paid);
  const sumPaid = paidRows.reduce((s, r) => s + r.total, 0);
  const sumPending = filtered.reduce((s, r) => s + (r.pendingAmount || 0), 0);
  const pendingItemCount = filtered.reduce((s, r) => s + (r.pendingCount || 0), 0);

  // 발주서 단위 폴더로 그룹핑 (자료실 폴더 느낌)
  const folders = useMemo(() => {
    const map = new Map();
    for (const r of filtered) {
      // 무엇으로 묶느냐에 따라 폴더의 정체가 달라진다
      //   project  … 발주 제목   supplier … 업체명   date … 결제 마감일
      const key =
        groupBy === 'project'
          ? r.purchaseId
          : groupBy === 'supplier'
            ? r.supplier || '(구매처 미지정)'
            : r.dueDate || '(마감일 미지정)';
      let f = map.get(key);
      if (!f) {
        f =
          groupBy === 'project'
            ? { key, purchaseId: r.purchaseId, title: r.title, siteName: r.siteName, rows: [], latest: 0 }
            : groupBy === 'supplier'
              ? { key, title: r.supplier || '(구매처 미지정)', siteName: '', rows: [], latest: 0 }
              : { key, title: r.dueDate ? `${r.dueDate} 마감` : '마감일 미지정', siteName: '', rows: [], latest: 0 };
        map.set(key, f);
      }
      f.rows.push(r);
      f.latest = Math.max(f.latest, ms(r.requestedAt));
    }
    const arr = Array.from(map.values());
    for (const f of arr) {
      f.pending = f.rows.filter((r) => !r.paid).length;
      f.paidCount = f.rows.filter((r) => r.paid).length;
      f.total = f.rows.reduce((s, r) => s + r.total, 0);
      // 미결제 건 중 가장 임박한 결제 마감일
      const dues = f.rows
        .filter((r) => !r.paid && r.dueDate)
        .map((r) => r.dueDate)
        .sort();
      f.nearestDue = dues[0] || '';
      f.rows.sort((a, b) => ms(b.requestedAt) - ms(a.requestedAt));
    }
    if (groupBy === 'date') {
      // 마감일이 빠른 순 — 급한 것이 맨 위. 미지정은 맨 뒤로.
      arr.sort((a, b) =>
        a.key === '(마감일 미지정)' ? 1 : b.key === '(마감일 미지정)' ? -1 : a.key.localeCompare(b.key),
      );
    } else {
      arr.sort((a, b) => b.latest - a.latest);
    }
    return arr;
  }, [filtered, groupBy]);

  // 마감일까지 남은 일수 — 일자별 폴더 부제에 쓴다
  function dDay(due, today) {
    const diff = Math.round((new Date(due) - new Date(today)) / 86400000);
    if (diff === 0) return 'D-DAY';
    return diff > 0 ? `D-${diff}` : `${-diff}일 초과`;
  }

  // 오늘(YYYY-MM-DD) — 결제 마감일 초과 강조용
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  function toggleFolder(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function applyPaidLocal(purchaseId, supplier, paidObj) {
    setPurchases((prev) =>
      prev.map((p) => {
        if (p.id !== purchaseId) return p;
        const next = { ...(p.supplierPaid || {}) };
        const k = supplier.replace(/\./g, '_');
        if (paidObj) next[k] = paidObj;
        else delete next[k];
        return { ...p, supplierPaid: next };
      }),
    );
  }

  // 홈택스 세금계산서(코드에프) 불러와 사업자번호로 결제 건에 매칭
  const [taxSyncing, setTaxSyncing] = useState(false);
  async function syncTaxInvoices() {
    if (taxSyncing) return;
    setTaxSyncing(true);
    try {
      // 조회 기간: 결제요청 가장 이른 달 ~ 오늘 (없으면 최근 3개월)
      const reqDates = allRows.map((r) => ms(r.requestedAt)).filter(Boolean);
      const start = reqDates.length ? new Date(Math.min(...reqDates)) : new Date(Date.now() - 90 * 864e5);
      const fmt = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const res = await fetch('/api/hometax/taxinvoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: fmt(start), endDate: fmt(new Date()) }),
      });
      const data = await res.json();
      if (data.configured === false) {
        toast('코드에프 키/공동인증서가 아직 설정되지 않았습니다. 발급 후 알려주세요.', 'error', 0);
        return;
      }
      if (data.error) {
        toast('홈택스 조회 오류: ' + data.error, 'error', 0);
        return;
      }
      const invoices = data.invoices || [];
      const byBiz = new Map(invoices.map((iv) => [String(iv.supplierBizNo || '').replace(/-/g, ''), iv]));
      let matched = 0;
      for (const r of allRows) {
        const biz = String(r.businessNumber || '').replace(/-/g, '');
        const iv = biz && byBiz.get(biz);
        if (!iv) continue;
        await setSupplierTaxInvoice(r.purchaseId, r.supplier, iv);
        matched += 1;
      }
      await load();
      toast(`홈택스 세금계산서 ${invoices.length}건 조회 · ${matched}건 매칭 완료`, matched ? 'success' : 'error', 0);
    } catch (e) {
      toast('불러오기 실패: ' + (e.message || e), 'error', 0);
    } finally {
      setTaxSyncing(false);
    }
  }

  async function pay(r) {
    if (
      !(await confirm({
        title: '결제 완료',
        message: `"${r.supplier}" · ${r.total.toLocaleString()}원(VAT 포함)\n결제 완료로 처리할까요?`,
      }))
    )
      return;
    setBusy(`${r.purchaseId}-${r.supplier}`);
    try {
      await markSupplierPaid(r.purchaseId, r.supplier, userProfile?.name || '');
      applyPaidLocal(r.purchaseId, r.supplier, { paidAt: new Date(), paidBy: userProfile?.name || '' });
      toast('결제 완료 처리했습니다.');
    } catch (err) {
      toast('처리 오류: ' + (err.message || err), 'error');
    } finally {
      setBusy('');
    }
  }
  async function cancelPay(r) {
    if (!(await confirm({ title: '결제 취소', message: `"${r.supplier}" 결제 완료를 취소할까요?` }))) return;
    setBusy(`${r.purchaseId}-${r.supplier}`);
    try {
      await unmarkSupplierPaid(r.purchaseId, r.supplier);
      applyPaidLocal(r.purchaseId, r.supplier, null);
      toast('결제 완료를 취소했습니다.');
    } catch (err) {
      toast('처리 오류: ' + (err.message || err), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="payment-page">
      {/* 결제 상태 탭 (제목 위 — 상단 탭 표준) */}
      <div className="tab-nav no-print" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`tab-nav-item ${filterMode === 'pending' ? 'active' : ''}`}
          onClick={() => setFilterMode('pending')}
        >
          결제 대기{pendingCount > 0 && <span className="tab-nav-count">{pendingCount}</span>}
        </button>
        <button
          type="button"
          className={`tab-nav-item ${filterMode === 'paid' ? 'active' : ''}`}
          onClick={() => setFilterMode('paid')}
        >
          결제 완료{paidCount > 0 && <span className="tab-nav-count">{paidCount}</span>}
        </button>
        <button
          type="button"
          className={`tab-nav-item ${filterMode === 'all' ? 'active' : ''}`}
          onClick={() => setFilterMode('all')}
        >
          전체
        </button>
      </div>

      <div className="page-header">
        <h2>결제</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={syncTaxInvoices} disabled={taxSyncing}>
            <Icon name={taxSyncing ? 'clock' : 'download'} className="btn-ic" />
            {taxSyncing ? '불러오는 중…' : '홈택스 세금계산서'}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={load} disabled={loading}>
            <Icon name="restore" className="btn-ic" />
            새로고침
          </button>
        </div>
      </div>
      <p className="field-hint" style={{ margin: '0 0 12px' }}>
        발주서 상세에서 <strong>결제 요청</strong>을 누르면 여기에 <strong>결제 대기</strong>로 올라옵니다. 업체명을
        누르면 등록된 <strong>사업자등록증</strong>을 확인할 수 있고, 확인 후 <strong>결제 완료</strong> 처리하세요.
      </p>

      {/* 년월 드롭다운 + 검색 */}
      <div className="payment-filterbar no-print">
        {/* 묶는 기준 — 프로젝트(발주서)별 / 업체별 */}
        <div className="payment-groupby">
          {[
            { k: 'project', label: '프로젝트별' },
            { k: 'supplier', label: '업체별' },
            { k: 'date', label: '일자별' },
          ].map((o) => (
            <button
              key={o.k}
              type="button"
              className={`btn btn-sm ${groupBy === o.k ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => {
                setGroupBy(o.k);
                setExpanded(new Set()); // 기준이 바뀌면 폴더 키가 달라지므로 접어 둔다
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        <select
          className="payment-month-select"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
          aria-label="결제요청 년월 선택"
        >
          <option value="all">전체 기간</option>
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {m.replace('.', '년 ')}월
            </option>
          ))}
        </select>
        <input
          className="purchase-filter-search"
          type="search"
          placeholder="발주 제목 · 업체 · 프로젝트 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="검색"
          style={{ flex: '1 1 240px', maxWidth: 360 }}
        />
      </div>

      {loading ? (
        <p className="text-muted">불러오는 중...</p>
      ) : folders.length === 0 ? (
        <div className="trash-empty">
          {filterMode === 'pending'
            ? '결제 대기 중인 발주가 없습니다.'
            : filterMode === 'paid'
              ? '결제 완료된 발주가 없습니다.'
              : '결제 요청된 건이 없습니다.'}
        </div>
      ) : (
        <>
          <div className="payment-folders">
            {folders.map((f) => {
              const open = expanded.has(f.key);
              const allPaid = f.pending === 0 && f.paidCount > 0;
              return (
                <div key={f.key} className={`payment-folder ${open ? 'is-open' : ''} ${allPaid ? 'is-paid' : ''}`}>
                  <button type="button" className="payment-folder-head" onClick={() => toggleFolder(f.key)}>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} className="payment-folder-caret" />
                    <Icon
                      name={groupBy === 'project' ? 'folder' : groupBy === 'supplier' ? 'building' : 'calendar'}
                      className="payment-folder-ic"
                    />
                    <span className="payment-folder-title" title={f.title}>
                      {f.title}
                    </span>
                    {groupBy === 'project' ? (
                      f.siteName && <span className="payment-folder-site">{f.siteName}</span>
                    ) : groupBy === 'supplier' ? (
                      <span className="payment-folder-site">
                        발주 {new Set(f.rows.map((r) => r.purchaseId)).size}건
                      </span>
                    ) : (
                      f.key !== '(마감일 미지정)' && (
                        <span className={`payment-folder-site${f.key < todayStr ? ' is-overdue' : ''}`}>
                          {dDay(f.key, todayStr)}
                        </span>
                      )
                    )}
                    <span className="payment-folder-spacer" />
                    {groupBy !== 'date' && f.nearestDue && (
                      <span className={`payment-folder-due${f.nearestDue < todayStr ? ' is-overdue' : ''}`}>
                        ~{f.nearestDue} 마감
                      </span>
                    )}
                    {f.pending > 0 && <span className="payment-folder-badge">대기 {f.pending}</span>}
                    {f.paidCount > 0 && <span className="payment-folder-badge is-done">완료 {f.paidCount}</span>}
                    <span className="payment-folder-amount">{f.total.toLocaleString()}원</span>
                  </button>

                  {open && (
                    <div className="payment-folder-body table-scroll-x">
                      <table className="table cards-sm payment-detail-table">
                        <thead>
                          <tr>
                            <th scope="col" style={{ width: 84 }}>
                              상태
                            </th>
                            <th scope="col" style={{ width: 150 }}>
                              상호
                            </th>
                            <th scope="col" style={{ width: 80 }}>
                              대표
                            </th>
                            <th scope="col" style={{ width: 120 }}>
                              연락처
                            </th>
                            <th scope="col" style={{ width: 170 }}>
                              이메일
                            </th>
                            <th scope="col" style={{ width: 120 }}>
                              사업자번호
                            </th>
                            <th scope="col" style={{ width: 90 }}>
                              은행
                            </th>
                            <th scope="col" style={{ width: 140 }}>
                              계좌번호
                            </th>
                            <th scope="col" style={{ width: 110 }}>
                              분류
                            </th>
                            <th scope="col" style={{ width: 150 }}>
                              비고
                            </th>
                            <th scope="col" style={{ width: 120 }}>
                              결제금액(VAT포함)
                            </th>
                            <th scope="col" style={{ width: 120 }}>
                              미입고
                            </th>
                            <th scope="col" style={{ width: 96 }}>
                              결제요청일
                            </th>
                            <th scope="col" style={{ width: 104 }}>
                              결제마감일
                            </th>
                            <th scope="col" style={{ width: 150 }}>
                              세금계산서
                            </th>
                            <th scope="col" className="col-action" style={{ width: 280 }}>
                              작업
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.rows.map((r) => {
                            const k = `${r.purchaseId}-${r.supplier}`;
                            return (
                              <tr key={k} className={r.paid ? 'is-paid-row' : ''}>
                                <td data-label="상태">
                                  <span
                                    className={`purchase-badge ${r.paid ? 'purchase-badge-received' : 'purchase-badge-draft'}`}
                                  >
                                    {r.paid ? '결제완료' : '결제대기'}
                                  </span>
                                </td>
                                <td data-label="상호" title={r.supplier}>
                                  <strong>{r.supplier}</strong>
                                </td>
                                <td data-label="대표" className="u-ellipsis" title={r.representative || ''}>
                                  {r.representative || '-'}
                                </td>
                                <td data-label="연락처" className="u-ellipsis" title={r.contact || ''}>
                                  {r.contact || '-'}
                                </td>
                                <td data-label="이메일" className="u-ellipsis" title={r.email || ''}>
                                  {r.email || '-'}
                                </td>
                                <td data-label="사업자번호" className="u-ellipsis" title={r.businessNumber || ''}>
                                  {r.businessNumber || '-'}
                                </td>
                                <td data-label="은행" className="u-ellipsis" title={r.bankName || ''}>
                                  {r.bankName || '-'}
                                </td>
                                <td data-label="계좌번호" className="u-wrap" title={r.bankAccount || ''}>
                                  {r.bankAccount || '-'}
                                </td>
                                <td data-label="분류" className="u-ellipsis" title={r.category || ''}>
                                  {r.category || '-'}
                                </td>
                                <td data-label="비고" className="supplier-note-cell" title={r.note || ''}>
                                  <span className="cell-clamp-2">{r.note || '-'}</span>
                                </td>
                                <td
                                  data-label="결제금액(VAT포함)"
                                  className="payment-amount-cell"
                                  title={`공급가 ${r.supply.toLocaleString()}`}
                                >
                                  {r.total.toLocaleString()}원
                                </td>
                                <td data-label="미입고" className="payment-amount-cell">
                                  {r.pendingCount > 0 ? (
                                    <span className="purchase-sup-amt is-pending">
                                      <strong>{r.pendingAmount.toLocaleString()}원</strong>
                                      <em>{r.pendingCount}품목 미입고</em>
                                    </span>
                                  ) : (
                                    <span className="text-muted">-</span>
                                  )}
                                </td>
                                <td data-label="결제요청일">{fmtDate(r.requestedAt)}</td>
                                <td data-label="결제마감일">
                                  {r.dueDate ? (
                                    <strong
                                      className={`payment-due${!r.paid && r.dueDate < todayStr ? ' is-overdue' : ''}`}
                                    >
                                      {fmtDate(r.dueDate)}
                                    </strong>
                                  ) : (
                                    <span className="text-muted">-</span>
                                  )}
                                </td>
                                <td data-label="세금계산서">
                                  {r.taxInvoice ? (
                                    <span
                                      className="purchase-badge purchase-badge-received"
                                      title={`승인번호 ${r.taxInvoice.approvalNo || '-'} · 공급가 ${(r.taxInvoice.supplyValue || 0).toLocaleString()} · 세액 ${(r.taxInvoice.tax || 0).toLocaleString()}`}
                                    >
                                      발행 {r.taxInvoice.writeDate || ''}
                                    </span>
                                  ) : (
                                    <span className="text-muted">-</span>
                                  )}
                                </td>
                                <td data-label="작업" className="col-action">
                                  <div className="row-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline"
                                      onClick={() => openBizDoc(r.supplier)}
                                      title="사업자등록증 보기/출력"
                                    >
                                      <Icon name="doc" className="btn-ic" />
                                      PDF 출력
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-outline"
                                      onClick={() => navigate(`/admin/purchase/${r.purchaseId}`)}
                                    >
                                      <Icon name="chevronRight" className="btn-ic" />
                                      발주서
                                    </button>
                                    {r.paid ? (
                                      <button
                                        type="button"
                                        className="btn btn-sm po-act-btn--on"
                                        onClick={() => cancelPay(r)}
                                        disabled={busy === k}
                                      >
                                        결제 취소
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-primary"
                                        onClick={() => pay(r)}
                                        disabled={busy === k}
                                      >
                                        결제 완료
                                      </button>
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
                </div>
              );
            })}
          </div>
          <div className="payment-sum-bar">
            <span>
              합계 ({filtered.length}건) · <strong>{sumTotal.toLocaleString()}원</strong>
            </span>
            <span className="payment-sum-part">
              결제 완료 {paidRows.length}건 · <strong>{sumPaid.toLocaleString()}원</strong>
            </span>
            <span className="payment-sum-part">
              미결제 {filtered.length - paidRows.length}건 · <strong>{(sumTotal - sumPaid).toLocaleString()}원</strong>
            </span>
            {pendingItemCount > 0 && (
              <span className="payment-sum-part is-pending">
                미입고 {pendingItemCount}품목 · <strong>{sumPending.toLocaleString()}원</strong>
              </span>
            )}
          </div>
        </>
      )}

      {/* 사업자등록증 미리보기 모달 */}
      <Modal
        isOpen={!!bizDoc}
        onClose={() => setBizDoc(null)}
        title={bizDoc ? `${bizDoc.supplier} · 거래처 정보` : '거래처 정보'}
        size="lg"
      >
        {bizDoc?.loading ? (
          <p className="text-muted">불러오는 중...</p>
        ) : bizDoc?.error ? (
          <div className="trash-empty">조회 오류: {bizDoc.error}</div>
        ) : !bizDoc?.files?.length ? (
          <div className="trash-empty">
            자료실 "거래처 정보 / {bizDoc?.supplier}" 폴더에 저장된 파일이 없습니다.
            <br />
            구매처 관리에서 사업자등록증·통장사본을 등록하면 여기에 표시됩니다.
          </div>
        ) : (
          <div className="biz-doc-list">
            {bizDoc.files.map((f) => {
              const isImg = (f.contentType || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name || '');
              const isPdf = (f.contentType || '').includes('pdf') || /\.pdf$/i.test(f.name || '');
              return (
                <div key={f.id} className="biz-doc-item">
                  <div className="biz-doc-head">
                    <Icon name="doc" className="biz-doc-ic" />
                    <span className="biz-doc-name" title={f.name}>
                      {f.name}
                    </span>
                    <a className="btn btn-sm btn-outline" href={f.downloadURL} target="_blank" rel="noreferrer">
                      <Icon name="download" className="btn-ic" />새 창
                    </a>
                  </div>
                  {isImg ? (
                    <img loading="lazy" className="biz-doc-img" src={f.downloadURL} alt={f.name} />
                  ) : isPdf ? (
                    <iframe className="biz-doc-frame" src={f.downloadURL} title={f.name} />
                  ) : (
                    <p className="text-muted" style={{ margin: '6px 0 0' }}>
                      미리보기를 지원하지 않는 형식입니다. "새 창"으로 열어주세요.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
