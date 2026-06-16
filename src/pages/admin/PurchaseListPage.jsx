import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getPurchases, addPurchase, setPurchaseStatus,
  getPurchaseConfig, setHqSite, deletePurchase, updatePurchase, getSuppliers,
} from '../../services/purchaseService';
import { trashPurchase } from '../../services/trashService';
import { getAllSites } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from '../../components/common/DialogProvider';
import Modal from '../../components/common/Modal';

const STATUS = {
  ordered: { label: '발주', cls: 'ordered' },
  partial: { label: '부분입고', cls: 'partial' },
  received: { label: '입고완료', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
};

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'ordered', label: '발주' },
  { key: 'partial', label: '부분입고' },
  { key: 'received', label: '입고완료' },
  { key: 'settled', label: '정산완료' },
];

const EMPTY_FORM = { title: '', siteId: '', supplierId: '', deliveryDue: '', contactName: '', contactPhone: '' };

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PurchaseListPage() {
  const { userProfile } = useAuth();
  const { alert, confirm } = useDialog();
  const navigate = useNavigate();

  const [purchases, setPurchases] = useState([]);
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [recentSiteId, setRecentSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  const [formModal, setFormModal] = useState(false);
  const [editingId, setEditingId] = useState(null); // null=등록, id=수정
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [p, st, cfg, us, sup] = await Promise.all([
        getPurchases(), getAllSites(), getPurchaseConfig(), getUsers(), getSuppliers(),
      ]);
      setUsers(us);
      setSuppliers(sup);
      const validStatus = ['ordered', 'partial', 'received', 'settled'];
      const legacy = p.filter((x) => !validStatus.includes(x.status));
      if (legacy.length > 0) {
        await Promise.all(legacy.map((x) => setPurchaseStatus(x.id, 'ordered')));
        legacy.forEach((x) => { x.status = 'ordered'; });
      }
      setPurchases(p);
      setSites(st);
      setRecentSiteId(cfg.hqSiteId || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    const c = { all: purchases.length };
    for (const p of purchases) c[p.status] = (c[p.status] || 0) + 1;
    c.printed = purchases.filter((p) => Number(p.printCount) > 0).length;
    return c;
  }, [purchases]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = purchases.filter((p) => {
      if (tab === 'printed') {
        if (!(Number(p.printCount) > 0)) return false;
      } else if (tab !== 'all' && p.status !== tab) {
        return false;
      }
      if (!kw) return true;
      return [p.title, p.supplierName, p.siteName, p.requesterName]
        .some((v) => (v || '').toLowerCase().includes(kw));
    });
    if (tab === 'printed') {
      const t = (p) => {
        const d = p.lastPrintedAt?.toDate ? p.lastPrintedAt.toDate() : (p.lastPrintedAt ? new Date(p.lastPrintedAt) : null);
        return d ? d.getTime() : 0;
      };
      list.sort((a, b) => t(b) - t(a)); // 최근 출력순
    }
    return list;
  }, [purchases, tab, search]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, siteId: recentSiteId || '' });
    setFormModal(true);
  }

  function openEdit(e, p) {
    e.stopPropagation();
    setEditingId(p.id);
    setForm({
      title: p.title || '',
      siteId: p.siteId || '',
      supplierId: p.supplierId || '',
      deliveryDue: p.deliveryDue || '',
      contactName: p.contactName || '',
      contactPhone: p.contactPhone || '',
    });
    setFormModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { alert('제목을 입력해주세요.'); return; }
    if (!form.siteId) { alert('프로젝트를 선택해주세요.'); return; }

    setSubmitting(true);
    try {
      const site = sites.find((s) => s.id === form.siteId);
      const supplier = suppliers.find((s) => s.id === form.supplierId);
      const base = {
        title: form.title.trim(),
        siteId: form.siteId,
        siteName: site?.name || '',
        supplierId: form.supplierId || '',
        supplierName: supplier?.name || '',
        deliveryDue: form.deliveryDue.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
      };
      if (editingId) {
        // 수정 — 기본정보만 갱신 (품목·금액은 상세에서 관리)
        await updatePurchase(editingId, base);
        setPurchases((prev) => prev.map((x) => (x.id === editingId ? { ...x, ...base } : x)));
        setFormModal(false);
      } else {
        const ref = await addPurchase({
          ...base,
          items: [],
          totalAmount: 0,
          requesterId: userProfile?.uid || '',
          requesterName: userProfile?.name || '',
        });
        if (form.siteId !== recentSiteId) {
          await setHqSite(form.siteId, site?.name || '');
          setRecentSiteId(form.siteId);
        }
        setFormModal(false);
        navigate(`/admin/purchase/${ref.id}`);
      }
    } catch (err) {
      alert((editingId ? '수정' : '등록') + ' 중 오류: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(e, p) {
    e.stopPropagation();
    if (!await confirm(`"${p.title}" 구매 건을 삭제하시겠습니까?\n(휴지통에서 복원할 수 있습니다)`)) return;
    try {
      await trashPurchase(p.id, userProfile?.name || ''); // 휴지통에 스냅샷 보관
      await deletePurchase(p.id);
      setPurchases((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-list-page printable-page">
      <div className="page-header">
        <h2>구매 · 발주 현황</h2>
        <div className="page-actions no-print">
          <button className="btn btn-sm btn-outline" onClick={() => navigate('/admin/purchase/trash?type=purchase')}>🗑 휴지통</button>
          <button className="btn btn-sm btn-primary" onClick={openCreate}>구매 등록</button>
        </div>
      </div>

      <button
        type="button"
        className="pdf-print-fab no-print"
        onClick={() => window.print()}
        title="PDF로 저장하려면 인쇄 다이얼로그에서 'PDF로 저장'을 선택하세요"
      >
        PDF 출력
      </button>

      <div className="tab-nav closing-tab-nav no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-nav-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className="tab-nav-count">{counts[t.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="purchase-filters no-print">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="제목 · 구매처 · 프로젝트 · 등록자 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="purchase-empty">
          {purchases.length === 0 ? '등록된 구매 건이 없습니다.' : '해당 조건의 구매 건이 없습니다.'}
        </p>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>제목</th>
              <th>구매처</th>
              <th>프로젝트</th>
              <th className="num-col">금액</th>
              <th>상태</th>
              <th>등록자</th>
              <th>발주일</th>
              <th style={{ textAlign: 'right' }}>작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="table-clickable-row"
                onClick={() => navigate(`/admin/purchase/${p.id}`)}
              >
                <td data-label="제목">
                  <strong>{p.title}</strong>
                  {Number(p.printCount) > 0 && (
                    <span className="purchase-print-badge" title={`최근 출력: ${fmtDate(p.lastPrintedAt)}${p.lastPrintedBy ? ` · ${p.lastPrintedBy}` : ''}`}>
                      🖨 {p.printCount}회 · {fmtDate(p.lastPrintedAt)}
                    </span>
                  )}
                </td>
                <td data-label="구매처">{p.supplierName || <span className="text-muted">-</span>}</td>
                <td data-label="프로젝트">{p.siteName || '-'}</td>
                <td data-label="금액" className="num-col">{Number(p.totalAmount || 0).toLocaleString()}원</td>
                <td data-label="상태">
                  <span className={`purchase-badge purchase-badge-${STATUS[p.status]?.cls || 'ordered'}`}>
                    {STATUS[p.status]?.label || p.status}
                  </span>
                </td>
                <td data-label="등록자">{p.requesterName || '-'}</td>
                <td data-label="발주일">{fmtDate(p.orderedAt || p.createdAt)}</td>
                <td data-label="작업" style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ marginRight: 6 }}
                    onClick={(e) => openEdit(e, p)}
                  >수정</button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={(e) => handleDelete(e, p)}
                  >삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal isOpen={formModal} onClose={() => setFormModal(false)} title={editingId ? '구매 수정' : '구매 등록'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>제목 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>프로젝트 *</label>
            <select
              value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}
              required
            >
              <option value="">선택</option>
              {sites
                .filter((s) => (s.status || 'active') !== 'completed')
                .map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
            </select>
            <p className="field-hint">최근 선택한 프로젝트가 다음 등록 시 자동 입력됩니다.</p>
          </div>

          <div className="form-group">
            <label>구매처</label>
            <select
              value={form.supplierId}
              onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            >
              <option value="">선택 (미지정 시 첫 품목 기본 구매처 자동 적용)</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>납기 (납품기일)</label>
            <input
              type="text"
              value={form.deliveryDue}
              onChange={(e) => setForm({ ...form, deliveryDue: e.target.value })}
            />
            <p className="field-hint">날짜 또는 "협의·긴급" 등 자유 입력. 비워두면 발주서에 "긴급"으로 표시됩니다.</p>
          </div>

          <div className="form-group">
            <label>직원에서 불러오기</label>
            <select
              value=""
              onChange={(e) => {
                const u = users.find((x) => x.id === e.target.value);
                if (u) setForm({ ...form, contactName: u.name || '', contactPhone: u.phone || '' });
              }}
            >
              <option value="">직원 선택 (담당자·연락처 자동 입력)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}{u.position ? ` · ${u.position}` : ''}{u.phone ? ` · ${u.phone}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>담당자</label>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>연락처</label>
              <input
                type="text"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              />
            </div>
          </div>

          <p className="field-hint">
            {editingId
              ? '제목·프로젝트·납기·담당자 등 기본정보를 수정합니다. 품목·수량·단가는 상세 페이지에서 관리합니다.'
              : '등록 즉시 상세 페이지로 이동합니다. 거기서 품목·수량·단가를 추가하세요. 구매처는 첫 품목의 기본 구매처에서 자동 적용됩니다.'}
          </p>

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (editingId ? '저장 중...' : '등록 중...') : (editingId ? '수정 저장' : '등록하고 품목 추가')}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setFormModal(false)} disabled={submitting}>
              취소
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
