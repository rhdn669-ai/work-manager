import { useState, useEffect, useMemo } from 'react';
import {
  getPurchaseItems, addPurchaseItem, updatePurchaseItem, deletePurchaseItem,
  getSuppliers,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

const EMPTY_FORM = {
  name: '', spec: '', unit: '', category: '', standardPrice: '',
  defaultSupplierId: '', siteIds: [], note: '',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 엑셀에서 복사한 텍스트(탭 구분, 줄바꿈 행 구분) → 품목 배열
// 컬럼 순서: 품명 / 규격 / 단위 / 분류 / 표준단가
function parseBulkText(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .map((cols) => ({
      name: (cols[0] || '').trim(),
      spec: (cols[1] || '').trim(),
      unit: (cols[2] || '').trim(),
      category: (cols[3] || '').trim(),
      standardPrice: (cols[4] || '').replace(/[^0-9.]/g, ''),
    }))
    .filter((r) => r.name && r.name !== '품명');
}

export default function PurchaseItemPage() {
  const { confirm, alert } = useDialog();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterSite, setFilterSite] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [it, sp, st] = await Promise.all([getPurchaseItems(), getSuppliers(), getAllSites()]);
      setItems(it);
      setSuppliers(sp);
      setSites(st);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const supplierMap = useMemo(() => {
    const m = {};
    suppliers.forEach((s) => { m[s.id] = s.name; });
    return m;
  }, [suppliers]);

  const siteMap = useMemo(() => {
    const m = {};
    sites.forEach((s) => { m[s.id] = s.name; });
    return m;
  }, [sites]);

  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((it) => { if (it.category) set.add(it.category); });
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return items.filter((it) => {
      if (kw && ![it.name, it.spec, it.category].some((v) => (v || '').toLowerCase().includes(kw))) return false;
      if (filterCategory && it.category !== filterCategory) return false;
      if (filterSupplier && it.defaultSupplierId !== filterSupplier) return false;
      if (filterSite && !(it.siteIds || []).includes(filterSite)) return false;
      return true;
    });
  }, [items, search, filterCategory, filterSupplier, filterSite]);

  const parsedBulk = useMemo(() => parseBulkText(bulkText), [bulkText]);

  function openCreate() {
    setEditTarget(null);
    setForm({ ...EMPTY_FORM, siteIds: [] });
    setShowModal(true);
  }

  function openEdit(it) {
    setEditTarget(it);
    setForm({
      name: it.name || '', spec: it.spec || '', unit: it.unit || '',
      category: it.category || '', standardPrice: it.standardPrice || '',
      defaultSupplierId: it.defaultSupplierId || '',
      siteIds: Array.isArray(it.siteIds) ? it.siteIds : [],
      note: it.note || '',
    });
    setShowModal(true);
  }

  function toggleSite(siteId) {
    setForm((f) => ({
      ...f,
      siteIds: f.siteIds.includes(siteId)
        ? f.siteIds.filter((id) => id !== siteId)
        : [...f.siteIds, siteId],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { alert('품명을 입력해주세요.'); return; }
    try {
      if (editTarget) {
        await updatePurchaseItem(editTarget.id, form);
      } else {
        await addPurchaseItem({ ...form, priceHistory: [] });
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(it) {
    if (!await confirm(`"${it.name}" 품목을 삭제하시겠습니까?`)) return;
    try {
      await deletePurchaseItem(it.id);
      await loadData();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  function openBulk() {
    setBulkText('');
    setBulkModal(true);
  }

  async function handleBulkSubmit() {
    if (parsedBulk.length === 0) { alert('인식된 품목이 없습니다. 붙여넣은 내용을 확인해주세요.'); return; }
    if (!await confirm(`${parsedBulk.length}개 품목을 일괄 등록하시겠습니까?`)) return;
    setBulkSaving(true);
    try {
      await Promise.all(parsedBulk.map((r) => addPurchaseItem({ ...r, priceHistory: [] })));
      setBulkModal(false);
      setBulkText('');
      await loadData();
      alert(`${parsedBulk.length}개 품목이 등록되었습니다.`);
    } catch (err) {
      alert('일괄 등록 중 오류: ' + err.message);
    } finally {
      setBulkSaving(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-item-page">
      <div className="page-header">
        <h2>구매 품목 관리</h2>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={openBulk}>엑셀 일괄 추가</button>
          <button className="btn btn-primary" onClick={openCreate}>품목 추가</button>
        </div>
      </div>

      <div className="purchase-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="품명 · 규격 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">분류 전체</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
          <option value="">구매처 전체</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}>
          <option value="">프로젝트 전체</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm" style={{ padding: '12px 0' }}>
          {items.length === 0 ? '등록된 품목이 없습니다.' : '조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>품명</th>
              <th>규격</th>
              <th>단위</th>
              <th>분류</th>
              <th>표준단가</th>
              <th>기본 구매처</th>
              <th>사용 프로젝트</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((it) => (
              <tr key={it.id}>
                <td data-label="품명"><strong>{it.name}</strong></td>
                <td data-label="규격">{it.spec || '-'}</td>
                <td data-label="단위">{it.unit || '-'}</td>
                <td data-label="분류">{it.category || '-'}</td>
                <td data-label="표준단가">
                  {it.standardPrice > 0 ? `${Number(it.standardPrice).toLocaleString()}원` : '-'}
                  {it.priceHistory?.length > 0 && (
                    <span className="price-since"> ({it.priceHistory[it.priceHistory.length - 1].date}~)</span>
                  )}
                </td>
                <td data-label="기본 구매처">{supplierMap[it.defaultSupplierId] || '-'}</td>
                <td data-label="사용 프로젝트">
                  {(it.siteIds || []).length > 0
                    ? (it.siteIds || []).map((id) => siteMap[id]).filter(Boolean).join(', ')
                    : '-'}
                </td>
                <td>
                  <div className="btn-group">
                    <button className="btn btn-sm btn-outline" onClick={() => openEdit(it)}>수정</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(it)}>삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? '품목 수정' : '품목 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>품명 *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>규격</label>
            <input type="text" value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} placeholder="예: 12mm, 1.5sq" />
          </div>
          <div className="form-group">
            <label>단위</label>
            <input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="예: 개, m, kg, 박스" />
          </div>
          <div className="form-group">
            <label>분류</label>
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="예: 전선, 배관, 공구" />
          </div>
          <div className="form-group">
            <label>표준단가 (원)</label>
            <input
              type="number"
              min="0"
              value={form.standardPrice}
              onChange={(e) => setForm({ ...form, standardPrice: e.target.value })}
            />
          </div>
          {editTarget && Array.isArray(editTarget.priceHistory) && editTarget.priceHistory.length > 0 && (
            <div className="form-group">
              <label>단가 변경 이력</label>
              <div className="price-history">
                {[...editTarget.priceHistory].reverse().map((h, i) => (
                  <div key={i} className="price-history-row">
                    <div className="ph-info">
                      <span className="price-history-date">{h.date}</span>
                      {h.supplierName && <span className="ph-supplier">{h.supplierName}</span>}
                      {Number(h.qty) > 0 && <span className="ph-qty">×{h.qty}</span>}
                    </div>
                    <strong>{Number(h.price).toLocaleString()}원</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="form-group">
            <label>기본 구매처</label>
            <select value={form.defaultSupplierId} onChange={(e) => setForm({ ...form, defaultSupplierId: e.target.value })}>
              <option value="">선택</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>사용 프로젝트</label>
            {sites.length === 0 ? (
              <p className="field-hint">등록된 프로젝트가 없습니다.</p>
            ) : (
              <div className="purchase-site-checks">
                {sites.map((s) => {
                  const on = form.siteIds.includes(s.id);
                  return (
                    <label key={s.id} className={`purchase-site-check ${on ? 'is-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleSite(s.id)}
                      />
                      {on && <span className="chip-check">✓</span>}
                      {s.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>메모</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editTarget ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>

      {/* 엑셀 일괄 추가 모달 */}
      <Modal isOpen={bulkModal} onClose={() => setBulkModal(false)} title="엑셀 일괄 추가">
        <div className="form-group">
          <label>엑셀에서 복사한 내용 붙여넣기</label>
          <p className="field-hint">
            컬럼 순서: <strong>품명 · 규격 · 단위 · 분류 · 표준단가</strong> (5개 열)<br />
            엑셀에서 해당 열들을 선택해 복사한 뒤 아래 칸에 붙여넣으세요. 첫 줄이 머리글(품명…)이면 자동 제외됩니다.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={7}
            placeholder="엑셀 셀 범위를 복사해 여기에 붙여넣기"
          />
        </div>

        {parsedBulk.length > 0 && (
          <div className="bulk-preview">
            <div className="bulk-preview-head">{parsedBulk.length}개 품목 인식됨</div>
            <table className="table">
              <thead>
                <tr><th>품명</th><th>규격</th><th>단위</th><th>분류</th><th>표준단가</th></tr>
              </thead>
              <tbody>
                {parsedBulk.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td>{r.spec || '-'}</td>
                    <td>{r.unit || '-'}</td>
                    <td>{r.category || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.standardPrice ? Number(r.standardPrice).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedBulk.length > 50 && (
              <p className="field-hint">… 미리보기는 50건까지, 등록은 전체 {parsedBulk.length}건</p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleBulkSubmit}
            disabled={bulkSaving || parsedBulk.length === 0}
          >
            {bulkSaving ? '등록 중…' : `${parsedBulk.length}개 등록`}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setBulkModal(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
