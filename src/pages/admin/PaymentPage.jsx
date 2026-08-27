import { useState, useEffect, useMemo, useCallback } from 'react';
import { getConfirmedKeys } from '../../services/marginClosingService';
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
import { supplierKey } from '../../domain/supplierContacts';
import { paidList, unpaidAmount } from '../../domain/payment';

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
  const [monthFilter, setMonthFilter] = useState(() => monthKey(new Date())); // 기본: 현재 월 (결제요청일 기준)
  // 마감 리스트에서 확정된 건 — 「이 돈 줘도 되나」를 알려 준다. 막지는 않는다
  const [confirmedKeys, setConfirmedKeys] = useState(() => new Set());
  const [expanded, setExpanded] = useState(() => new Set()); // 펼친 폴더 키
  // 묶는 기준 — 업체별 / 발주서(프로젝트)별 / 일자별(결제 마감일)
  // 처음 열면 업체별이다. 결제는 회사 대 회사로 나가므로 「이 업체에 얼마」가 먼저다
  // (2026-08-27 대표님). 마감 리스트도 업체 고정이라 두 화면이 같은 눈으로 열린다.
  const [groupBy, setGroupBy] = useState('supplier');
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

  // 마감 확정 기록 — 한 번만 읽는다. 보는 달과 확정 달이 어긋나도 놓치지 않게
  // 최근 열두 달을 통째로 가져온다(monthFilter='전체'일 때도 동작).
  useEffect(() => {
    let cancelled = false;
    getConfirmedKeys()
      .then((set) => {
        if (!cancelled) setConfirmedKeys(set);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
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
      const seenSup = new Set(); // 담당이 갈린 업체는 목록에 두 번 나온다 — 결제는 한 줄로 묶는다
      for (const sup of supList) {
        // 결제는 회사 대 회사 — 담당이 갈려도 업체 하나로 본다 (2026-08-20 대표님).
        // 담당별로 저장된 옛 요청(업체명__담당)도 같은 업체 것으로 받아 준다.
        const key = supplierKey(sup.name, null);
        if (seenSup.has(key)) continue;
        seenSup.add(key);
        const supInfo = supByName.get(sup.name) || {};
        const byContact = (m) => Object.entries(m || {}).find(([k]) => k.startsWith(`${key}__`))?.[1];
        const req = reqMap[key] || byContact(reqMap);
        if (!req) continue; // 결제 요청된 업체만
        const paid = p.supplierPaid?.[key] || byContact(p.supplierPaid);
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
        // 회차 결제 — 나눠 들어온 물량은 들어온 만큼씩 나눠 낸다.
        // 이미 낸 회차는 각각 한 줄, 아직 안 낸 몫이 있으면 그 몫으로 한 줄 더.
        const paidRows = paidList(paid);
        const unpaid = unpaidAmount(supply, paid);
        const rowCount = paidRows.length + (unpaid > 0 ? 1 : 0);
        const base = {
          purchaseId: p.id,
          title: p.title || '(제목 없음)',
          siteName: p.siteName || '',
          supplier: sup.name,
          supplierKey: key, // 결제 완료·취소는 이 키로 (업체 단위)
          representative: supInfo.representative || '',
          contact: supInfo.contact || '',
          email: supInfo.email || '',
          businessNumber: supInfo.businessNumber || '',
          bankName: supInfo.bankName || '',
          bankAccount: supInfo.bankAccount || '',
          category: supInfo.category || '',
          note: supInfo.note || '',
          taxInvoice: p.taxInvoice?.[key] || null,
          requestedAt: req.requestedAt,
          dueDate: req.dueDate || '',
          seqTotal: rowCount,
        };
        for (const pd of paidRows) {
          const amt = pd.amount == null ? supply : Number(pd.amount) || 0;
          out.push({
            ...base,
            seq: pd.seq || paidRows.indexOf(pd) + 1,
            supply: amt,
            total: amt + Math.round(amt * 0.1),
            pendingAmount: 0,
            pendingCount: 0,
            paid: true,
            paidAt: pd.paidAt,
            paidBy: pd.paidBy || '',
            canCancel: pd.seq === paidRows.length || paidRows.indexOf(pd) === paidRows.length - 1,
          });
        }
        if (unpaid <= 0 && paidRows.length > 0) continue; // 남은 몫 없음 — 완료 줄만
        const vat = Math.round(unpaid * 0.1);
        out.push({
          ...base,
          seq: paidRows.length + 1,
          supply: unpaid,
          total: unpaid + vat,
          pendingAmount,
          pendingCount,
          paid: false,
          canCancel: false,
        });
      }
    }
    // 마감 확정 여부 — 마감 리스트와 같은 열쇠를 쓴다. 확정 안 된 건은 금액이 아직
    // 업체 내역과 대조되지 않았다는 뜻이라 알려 준다. 막지는 않는다 (2026-08-27 대표님).
    for (const r of out) r.closingConfirmed = confirmedKeys.has(`po:${r.purchaseId}:${r.supplierKey}`);
    out.sort((a, b) => ms(b.requestedAt) - ms(a.requestedAt));
    return out;
  }, [purchases, itemMaster, suppliers, supByName, confirmedKeys]);

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
  }, [allRows, monthFilter, search]);

  const sumTotal = filtered.reduce((s, r) => s + r.total, 0);
  // 끝난 돈·남은 돈·아직 안 들어온 몫을 한 줄에서 본다
  const paidRows = filtered.filter((r) => r.paid);
  const sumPaid = paidRows.reduce((s, r) => s + r.total, 0);
  const sumPending = filtered.reduce((s, r) => s + (r.pendingAmount || 0), 0);
  // 요약 카드용 — 아직 줄 돈과 이미 준 돈
  const sumWait = filtered.filter((r) => !r.paid).reduce((s, r) => s + r.total, 0);
  const vendorCount = new Set(filtered.map((r) => r.supplier)).size;
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
    setBusy(`${r.purchaseId}-${r.supplier}-${r.seq || 1}`);
    try {
      await markSupplierPaid(r.purchaseId, r.supplierKey || r.supplier, userProfile?.name || '', r.supply);
      applyPaidLocal(r.purchaseId, r.supplierKey || r.supplier, {
        paidAt: new Date(),
        paidBy: userProfile?.name || '',
      });
      toast('결제 완료 처리했습니다.');
    } catch (err) {
      toast('처리 오류: ' + (err.message || err), 'error');
    } finally {
      setBusy('');
    }
  }
  async function cancelPay(r) {
    if (!(await confirm({ title: '결제 취소', message: `"${r.supplier}" 결제 완료를 취소할까요?` }))) return;
    setBusy(`${r.purchaseId}-${r.supplier}-${r.seq || 1}`);
    try {
      await unmarkSupplierPaid(r.purchaseId, r.supplierKey || r.supplier);
      applyPaidLocal(r.purchaseId, r.supplierKey || r.supplier, null);
      toast('결제 완료를 취소했습니다.');
    } catch (err) {
      toast('처리 오류: ' + (err.message || err), 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="payment-page">
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
        발주서 상세에서 <strong>결제 요청</strong>을 누르면 여기에 <strong>결제 대기</strong>로 올라옵니다. 마감
        리스트에서 확정하지 않은 건은 <strong>「마감 미확정」</strong>으로 표시됩니다.
      </p>

      {/* 년월 드롭다운 + 검색 */}
      <div className="payment-filterbar no-print">
        {/* 묶는 기준 — 업체별(기본) / 프로젝트(발주서)별 / 일자별 */}
        <div className="payment-groupby">
          {[
            { k: 'supplier', label: '업체별' },
            { k: 'project', label: '프로젝트별' },
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
        <div className="trash-empty">결제 요청된 건이 없습니다.</div>
      ) : (
        <>
          {/* 요약 — 마감 리스트와 같은 얼굴. 돈을 다루는 화면은 첫인상이 같아야 한다 */}
          <div className="sum-cards no-print">
            <div className="sum-card is-wait">
              <div className="sum-card-label">
                결제 대기 <span className="sum-card-note">VAT 포함</span>
              </div>
              <div className="sum-card-value">
                {sumWait.toLocaleString()}
                <em>원</em>
              </div>
              {/* 마감 확정된 몫과 아직 대조 전인 몫을 갈라 준다 */}
              <div className="sum-card-sub">
                마감 확정{' '}
                {filtered
                  .filter((r) => !r.paid && r.closingConfirmed)
                  .reduce((a, r) => a + r.total, 0)
                  .toLocaleString()}
                원
              </div>
              <div className="sum-card-sub">{pendingCount > 0 ? <b>대기 {pendingCount}건</b> : '대기 없음'}</div>
            </div>
            {/* 공급가 — 마감 리스트가 이 값으로 본다. 대조하려면 제 칸이 있어야 한다 */}
            <div className="sum-card">
              <div className="sum-card-label">
                공급가 <span className="sum-card-note">VAT 별도</span>
              </div>
              <div className="sum-card-value">
                {filtered
                  .filter((r) => !r.paid)
                  .reduce((a, r) => a + r.supply, 0)
                  .toLocaleString()}
                <em>원</em>
              </div>
              <div className="sum-card-sub">마감 리스트와 대조하는 값</div>
            </div>
            <div className="sum-card is-good">
              <div className="sum-card-label">결제 완료</div>
              <div className="sum-card-value">
                {sumPaid.toLocaleString()}
                <em>원</em>
              </div>
              <div className="sum-card-sub">완료 {paidCount}건</div>
            </div>
            <div className="sum-card">
              <div className="sum-card-label">합계</div>
              <div className="sum-card-value">
                {sumTotal.toLocaleString()}
                <em>원</em>
              </div>
              <div className="sum-card-sub">업체 {vendorCount}곳</div>
            </div>
          </div>

          {pendingCount + paidCount > 0 && (
            <div className="sum-prog no-print">
              <div className="sum-prog-text">
                {pendingCount + paidCount}건 중 <b>{paidCount}건</b> 결제 완료
              </div>
              <div className="sum-prog-bar">
                <i
                  style={{
                    width: `${Math.round((paidCount / (pendingCount + paidCount)) * 100)}%`,
                  }}
                />
              </div>
              <div className="sum-prog-left">남은 {pendingCount}건</div>
            </div>
          )}

          <div className="payment-folders">
            {folders.map((f) => {
              const open = expanded.has(f.key);
              const allPaid = f.pending === 0 && f.paidCount > 0;
              // 아직 마감 확정 안 된 미결제 건 — 접힌 채로도 보여야 지나치지 않는다
              const unconfirmed = f.rows.filter((r) => !r.paid && !r.closingConfirmed).length;
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
                    {unconfirmed > 0 && <span className="pay-unconfirmed">마감 미확정 {unconfirmed}</span>}
                    {f.pending > 0 && <span className="payment-folder-badge">대기 {f.pending}</span>}
                    {f.paidCount > 0 && <span className="payment-folder-badge is-done">완료 {f.paidCount}</span>}
                    <span className="fold-amount-vat" title="공급가 (부가세 별도)">
                      공급가 {f.rows.reduce((a, r) => a + r.supply, 0).toLocaleString()}원
                    </span>
                    <span className="payment-folder-amount" title="부가세 포함 — 실제 나갈 돈">
                      {f.total.toLocaleString()}원
                    </span>
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
                              공급가
                            </th>
                            <th scope="col" style={{ width: 140 }}>
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
                            const k = `${r.purchaseId}-${r.supplier}-${r.seq || 1}`;
                            const seqTag = r.seqTotal > 1 ? `${r.seq}차` : '';
                            return (
                              <tr key={k} className={r.paid ? 'is-paid-row' : ''}>
                                <td data-label="상태">
                                  <span
                                    className={`purchase-badge ${r.paid ? 'purchase-badge-received' : 'purchase-badge-draft'}`}
                                  >
                                    {seqTag ? `${seqTag} ` : ''}
                                    {r.paid ? '결제완료' : '결제대기'}
                                  </span>
                                  {/* 마감 확정 전이면 금액이 아직 업체 내역과 대조되지 않았다 */}
                                  {!r.paid && !r.closingConfirmed && (
                                    <span
                                      className="pay-unconfirmed"
                                      title="마감 리스트에서 아직 확정하지 않았습니다 — 금액이 업체 내역과 대조되기 전입니다"
                                    >
                                      마감 미확정
                                    </span>
                                  )}
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
                                {/* 마감 리스트는 공급가로 본다 — 대조하려면 제 칸이 있어야 한다 */}
                                <td data-label="공급가" className="payment-amount-cell pay-supply">
                                  {r.supply.toLocaleString()}원
                                </td>
                                <td data-label="결제금액(VAT포함)" className="payment-amount-cell">
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
                                        disabled={busy === k || !r.canCancel}
                                        title={
                                          r.canCancel
                                            ? '결제 완료를 취소합니다'
                                            : '앞선 회차는 무를 수 없습니다 — 마지막 회차부터 취소하세요'
                                        }
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
