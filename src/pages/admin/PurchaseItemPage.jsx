import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  getPurchaseItems, addPurchaseItem, updatePurchaseItem, deletePurchaseItem,
  getSuppliers, nextMainCode, nextSubCode,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

function parseBulkText(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .map((cols) => ({
      code: (cols[0] || '').trim(),
      name: (cols[1] || '').trim(),
      maker: (cols[2] || '').trim(),
      spec: (cols[3] || '').trim(),
      unit: (cols[4] || '').trim(),
      category: (cols[5] || '').trim(),
      standardPrice: (cols[6] || '').replace(/[^0-9.]/g, ''),
    }))
    .filter((r) => r.name && r.name !== '품명' && r.code !== '코드');
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
  const [expandedId, setExpandedId] = useState(null);
  const [siteDropdownOpenId, setSiteDropdownOpenId] = useState(null);

  // 엑셀 일괄 추가 모달
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // 외부 클릭 시 사용 프로젝트 드롭다운 닫기 (mousedown 대신 click — 체크박스 onChange가 먼저 발화하도록)
  useEffect(() => {
    if (!siteDropdownOpenId) return;
    function onClickOutside(e) {
      if (!e.target.closest('.multi-select')) {
        setSiteDropdownOpenId(null);
      }
    }
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, [siteDropdownOpenId]);

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

  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((it) => { if (it.category) set.add(it.category); });
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const result = items.filter((it) => {
      if (kw && ![it.code, it.name, it.spec, it.maker, it.category].some((v) => (v || '').toLowerCase().includes(kw))) return false;
      if (filterCategory && it.category !== filterCategory) return false;
      if (filterSupplier && it.defaultSupplierId !== filterSupplier) return false;
      if (filterSite && !(it.siteIds || []).includes(filterSite)) return false;
      return true;
    });
    // 코드 오름차순 — 작은 번호(IOPN-00001)가 위로
    result.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    return result;
  }, [items, search, filterCategory, filterSupplier, filterSite]);

  const parsedBulk = useMemo(() => parseBulkText(bulkText), [bulkText]);

  // ---- 인라인 편집 ----
  function updateField(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function toggleSite(id, siteId) {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const cur = Array.isArray(it.siteIds) ? it.siteIds : [];
      return { ...it, siteIds: cur.includes(siteId) ? cur.filter((x) => x !== siteId) : [...cur, siteId] };
    }));
  }

  async function flushItem(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const isNew = String(id).startsWith('tmp-');
    if (isNew && !(it.name || '').trim()) return; // 빈 행 무시

    const payload = { ...it };

    try {
      if (isNew) {
        const ref = await addPurchaseItem({ ...payload, priceHistory: [] });
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, id: ref.id, code: payload.code } : x)));
        if (expandedId === id) setExpandedId(ref.id);
      } else {
        const { id: _id, createdAt: _c, updatedAt: _u, ...data } = payload;
        await updatePurchaseItem(id, data);
      }
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  }

  function addRow() {
    const tmpId = `tmp-${Date.now()}`;
    setItems((prev) => [{
      id: tmpId,
      code: nextMainCode(prev), // 새 대분류 (IOPN-NNNNN)
      name: '', spec: '', maker: '', unit: '', category: '',
      standardPrice: 0, defaultSupplierId: '', siteIds: [], note: '',
      priceHistory: [],
    }, ...prev]);
    setExpandedId(null);
    // 검색/필터를 비워야 새 행이 보임
    setSearch(''); setFilterCategory(''); setFilterSupplier(''); setFilterSite('');
  }

  function addSameItem(parent) {
    const code = nextSubCode(items, parent.code);
    if (!code) { alert('부모 코드가 잘못되어 동일품명을 추가할 수 없습니다.'); return; }
    const tmpId = `tmp-${Date.now()}`;
    const newItem = {
      id: tmpId,
      code,
      name: parent.name || '',
      spec: '',
      maker: parent.maker || '',
      unit: parent.unit || '',
      category: parent.category || '',
      standardPrice: 0,
      defaultSupplierId: parent.defaultSupplierId || '',
      siteIds: Array.isArray(parent.siteIds) ? [...parent.siteIds] : [],
      note: '',
      priceHistory: [],
    };
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === parent.id);
      if (idx < 0) return [newItem, ...prev];
      return [...prev.slice(0, idx + 1), newItem, ...prev.slice(idx + 1)];
    });
  }

  async function handleDelete(it) {
    if (!await confirm(`"${it.name || '이 항목'}"을(를) 삭제하시겠습니까?`)) return;
    if (String(it.id).startsWith('tmp-')) {
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      return;
    }
    try {
      await deletePurchaseItem(it.id);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  // ---- 엑셀 일괄 ----
  function openBulk() {
    setBulkText('');
    setBulkModal(true);
  }

  async function handleBulkSubmit() {
    if (parsedBulk.length === 0) { alert('인식된 품목이 없습니다. 붙여넣은 내용을 확인해주세요.'); return; }
    if (!await confirm(`${parsedBulk.length}개 품목을 일괄 등록하시겠습니까?`)) return;
    setBulkSaving(true);
    try {
      // 빈 코드 행은 IOPN-XXXXX-N 자동 부여 (품명 기준 대분류/소분류, 기존 items + 누적 계산)
      let buf = [...items];
      const withCodes = parsedBulk.map((r) => {
        if (r.code) return r;
        const code = nextItemCode(buf, r.name);
        buf = [...buf, { code, name: r.name }];
        return { ...r, code };
      });
      await Promise.all(withCodes.map((r) => addPurchaseItem({ ...r, priceHistory: [] })));
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
          <button className="btn btn-primary" onClick={addRow}>+ 품목 추가</button>
        </div>
      </div>

      <div className="purchase-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="코드 · 품명 · 규격 · 메이커 검색"
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

      <table className="table inline-edit-table cards-sm">
        <thead>
          <tr>
            <th style={{ minWidth: 100 }}>코드</th>
            <th style={{ minWidth: 160 }}>품명</th>
            <th>메이커</th>
            <th>규격</th>
            <th>단위</th>
            <th>분류</th>
            <th>표준단가</th>
            <th style={{ minWidth: 200 }}>사용 프로젝트</th>
            <th>기본 구매처</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr><td colSpan={10} className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>
              {items.length === 0 ? '등록된 품목이 없습니다 — 우측 상단 "+ 품목 추가" 또는 "엑셀 일괄 추가"' : '조건에 맞는 품목이 없습니다.'}
            </td></tr>
          )}
          {filtered.map((it) => {
            const expanded = expandedId === it.id;
            return (
              <Fragment key={it.id}>
                <tr>
                  <td data-label="코드">
                    <input
                      type="text"
                      value={it.code || ''}
                      placeholder="코드"
                      onChange={(e) => updateField(it.id, { code: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                      autoFocus={String(it.id).startsWith('tmp-')}
                    />
                  </td>
                  <td data-label="품명">
                    <input
                      type="text"
                      value={it.name || ''}
                      placeholder="품명"
                      onChange={(e) => updateField(it.id, { name: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                    />
                  </td>
                  <td data-label="메이커">
                    <input
                      type="text"
                      value={it.maker || ''}
                      onChange={(e) => updateField(it.id, { maker: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                    />
                  </td>
                  <td data-label="규격">
                    <input
                      type="text"
                      value={it.spec || ''}
                      onChange={(e) => updateField(it.id, { spec: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                    />
                  </td>
                  <td data-label="단위">
                    <input
                      type="text"
                      value={it.unit || ''}
                      placeholder="개·m·kg"
                      onChange={(e) => updateField(it.id, { unit: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                    />
                  </td>
                  <td data-label="분류">
                    <input
                      type="text"
                      value={it.category || ''}
                      onChange={(e) => updateField(it.id, { category: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                    />
                  </td>
                  <td data-label="표준단가" className="item-cell-price">
                    <input
                      type="number" min="0"
                      value={it.standardPrice || ''}
                      onChange={(e) => updateField(it.id, { standardPrice: Number(e.target.value) || 0 })}
                      onBlur={() => flushItem(it.id)}
                    />
                    {it.priceHistory?.length > 0 && (
                      <span className="price-since">{it.priceHistory[it.priceHistory.length - 1].date}~</span>
                    )}
                  </td>
                  <td data-label="사용 프로젝트">
                    {sites.length === 0 ? (
                      <span className="text-muted text-sm">프로젝트 없음</span>
                    ) : (() => {
                      const selectedIds = it.siteIds || [];
                      const selectedNames = selectedIds
                        .map((id) => sites.find((s) => s.id === id)?.name)
                        .filter(Boolean);
                      const open = siteDropdownOpenId === it.id;
                      return (
                        <div className="site-dropdown">
                          <button
                            type="button"
                            className="site-dropdown-trigger"
                            onClick={() => setSiteDropdownOpenId(open ? null : it.id)}
                          >
                            {selectedNames.length === 0 ? (
                              <span className="text-muted">선택</span>
                            ) : (
                              <span>
                                {selectedNames.slice(0, 2).join(', ')}
                                {selectedNames.length > 2 && ` 외 ${selectedNames.length - 2}`}
                              </span>
                            )}
                            <span className="site-dropdown-arrow">{open ? '▴' : '▾'}</span>
                          </button>
                          {open && (
                            <div className="site-dropdown-menu">
                              {sites.map((s) => {
                                const on = selectedIds.includes(s.id);
                                return (
                                  <label key={s.id} className={`site-dropdown-item ${on ? 'is-checked' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={on}
                                      onChange={() => {
                                        toggleSite(it.id, s.id);
                                        setTimeout(() => flushItem(it.id), 0);
                                      }}
                                    />
                                    <span>{s.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td data-label="기본 구매처">
                    <select
                      value={it.defaultSupplierId || ''}
                      onChange={(e) => {
                        updateField(it.id, { defaultSupplierId: e.target.value });
                        setTimeout(() => flushItem(it.id), 0);
                      }}
                    >
                      <option value="">선택</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td className="item-actions-cell">
                    <button
                      type="button"
                      className="item-same-btn"
                      onClick={() => addSameItem(it)}
                      title="같은 품명으로 다른 규격 추가 (소분류 -N)"
                    >+ 동일</button>
                    <button
                      type="button"
                      className="item-expand-btn"
                      onClick={() => setExpandedId(expanded ? null : it.id)}
                      title={expanded ? '접기' : '상세 보기 (메모·단가 이력)'}
                    >
                      {expanded ? '∧' : '∨'}
                    </button>
                    <button
                      type="button"
                      className="closing-delete"
                      onClick={() => handleDelete(it)}
                      aria-label="삭제"
                    >✕</button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="item-detail-row">
                    <td colSpan={10}>
                      <div className="item-detail-body">
                        <div className="item-detail-section">
                          <label className="item-detail-label">메모</label>
                          <textarea
                            rows={2}
                            value={it.note || ''}
                            onChange={(e) => updateField(it.id, { note: e.target.value })}
                            onBlur={() => flushItem(it.id)}
                          />
                        </div>

                        {Array.isArray(it.priceHistory) && it.priceHistory.length > 0 && (
                          <div className="item-detail-section">
                            <label className="item-detail-label">단가 변경 이력</label>
                            <div className="price-history">
                              {[...it.priceHistory].reverse().map((h, i) => (
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
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {/* 엑셀 일괄 추가 모달 */}
      <Modal isOpen={bulkModal} onClose={() => setBulkModal(false)} title="엑셀 일괄 추가">
        <div className="form-group">
          <label>엑셀에서 복사한 내용 붙여넣기</label>
          <p className="field-hint">
            컬럼 순서: <strong>코드 · 품명 · 메이커 · 규격 · 단위 · 분류 · 표준단가</strong> (7개 열)<br />
            엑셀에서 해당 열들을 선택해 복사한 뒤 아래 칸에 붙여넣으세요. 첫 줄이 머리글(코드/품명…)이면 자동 제외됩니다.
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
                <tr><th>코드</th><th>품명</th><th>메이커</th><th>규격</th><th>단위</th><th>분류</th><th>표준단가</th></tr>
              </thead>
              <tbody>
                {parsedBulk.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.code || '-'}</td>
                    <td>{r.name}</td>
                    <td>{r.maker || '-'}</td>
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
