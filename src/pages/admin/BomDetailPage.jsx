import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getBomBySite, addBomItem, updateBomItem, deleteBomItem,
  getBomProjectById,
} from '../../services/bomService';
import { getPurchaseItems } from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

export default function BomDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { confirm, alert } = useDialog();

  const [project, setProject] = useState(null);
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Set());

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [p, im] = await Promise.all([
          getBomProjectById(projectId),
          getPurchaseItems(),
        ]);
        if (!p) {
          alert('해당 프로젝트를 찾을 수 없습니다.');
          navigate('/admin/purchase/bom');
          return;
        }
        const items = await getBomBySite(projectId);
        setProject(p);
        setItemMaster(im);
        setBomItems(items);
      } catch (err) {
        console.error(err);
        alert('불러오기 오류: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const masterMap = useMemo(() => {
    const m = {};
    itemMaster.forEach((it) => { m[it.id] = it; });
    return m;
  }, [itemMaster]);

  const displayItems = useMemo(() => bomItems.map((b) => {
    const m = b.itemId ? masterMap[b.itemId] : null;
    return {
      ...b,
      code: m?.code || b.code || '',
      name: m?.name || b.name || '',
      spec: m?.spec || b.spec || '',
      unit: m?.unit || b.unit || '',
      maker: m?.maker || '',
      category: m?.category || '',
      // 단가는 마스터의 표준단가를 우선 표시 (마스터 변경 시 BOM도 자동 반영)
      unitPrice: m?.standardPrice ?? b.unitPrice ?? 0,
    };
  }), [bomItems, masterMap]);

  // 검색 필터 + 코드 자연 정렬
  const rows = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const kw = search.trim().toLowerCase();
    const list = kw
      ? displayItems.filter((it) =>
        [it.code, it.name, it.spec, it.maker, it.category, it.note]
          .some((v) => (v || '').toLowerCase().includes(kw)),
      )
      : displayItems;
    return [...list].sort((a, b) => collator.compare(a.code || '', b.code || ''));
  }, [displayItems, search]);

  const total = useMemo(
    () => displayItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
    [displayItems],
  );

  function updateField(id, patch) {
    setBomItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  async function flushItem(id) {
    const item = bomItems.find((b) => b.id === id);
    if (!item) return;
    try {
      const { id: _, createdAt: __, updatedAt: ___, ...data } = item;
      await updateBomItem(id, data);
    } catch (err) {
      alert('저장 오류: ' + err.message);
    }
  }

  async function removeRow(id) {
    const item = displayItems.find((b) => b.id === id);
    if (!await confirm(`"${item?.name || '이 항목'}"을(를) BOM에서 삭제하시겠습니까?`)) return;
    try {
      await deleteBomItem(id);
      setBomItems((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  function openPicker() {
    setPicked(new Set());
    setPickerSearch('');
    setPickerOpen(true);
  }

  function togglePick(itemId) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  const filteredMaster = useMemo(() => {
    const kw = pickerSearch.trim().toLowerCase();
    const inBomIds = new Set(bomItems.map((b) => b.itemId).filter(Boolean));
    let list = itemMaster.filter((m) => !inBomIds.has(m.id));
    if (kw) {
      list = list.filter((m) =>
        [m.code, m.name, m.spec, m.category].some((v) => (v || '').toLowerCase().includes(kw)),
      );
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return list.sort((a, b) => collator.compare(a.code || '', b.code || ''));
  }, [itemMaster, bomItems, pickerSearch]);

  async function addPickedToBom() {
    if (picked.size === 0) { setPickerOpen(false); return; }
    let nextOrder = bomItems.length === 0
      ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    const added = [];
    for (const itemId of picked) {
      const m = masterMap[itemId];
      if (!m) continue;
      const data = {
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        qty: 0,
        unitPrice: Number(m.standardPrice) || 0,
        note: '',
        order: nextOrder++,
      };
      try {
        const ref = await addBomItem(projectId, data);
        added.push({ ...data, id: ref.id, siteId: projectId, code: m.code });
      } catch (err) {
        console.error(err);
      }
    }
    setBomItems((prev) => [...prev, ...added]);
    setPicked(new Set());
    setPickerOpen(false);
  }

  if (loading || !project) return <div className="loading">로딩 중...</div>;

  return (
    <div className="bom-page">
      <div className="page-header">
        <div className="purchase-detail-header-left">
          <Link to="/admin/purchase/bom" className="purchase-back-link">← 프로젝트 목록</Link>
          <h2>{project.name}</h2>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={openPicker}>+ 품목 불러오기</button>
        </div>
      </div>

      <div className="purchase-filters bom-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="코드 · 품명 · 규격 · 메이커 · 분류 · 비고 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="bom-summary">
          <span>항목 <strong>{bomItems.length}</strong>건</span>
          <span>예상 합계 <strong>{total.toLocaleString()}원</strong></span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="purchase-empty">
          {bomItems.length === 0
            ? '품목이 없습니다 — 우측 상단 "+ 품목 불러오기"로 추가하세요.'
            : '검색 조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <div className="item-group is-expanded bom-flat-group">
          <div className="item-group-detail">
            <table className="table inline-edit-table cards-sm bom-flat-table">
              <thead>
                <tr>
                  <th className="bom-spacer-col" aria-hidden="true"></th>
                  <th style={{ minWidth: 100 }}>코드</th>
                  <th style={{ minWidth: 160 }}>품명</th>
                  <th>메이커</th>
                  <th>규격</th>
                  <th>분류</th>
                  <th>moq/단위</th>
                  <th>수량</th>
                  <th>단가</th>
                  <th>합계</th>
                  <th style={{ minWidth: 160 }}>비고</th>
                  <th className="bom-action-col" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                  return (
                    <tr key={it.id}>
                      <td className="bom-spacer-col" aria-hidden="true"></td>
                      <td data-label="코드">
                        <input
                          type="text"
                          className="bom-readonly-input bom-code-input"
                          value={it.code || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="품명">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={it.name || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="메이커">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={it.maker || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="규격">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={it.spec || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="분류">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={it.category || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="moq/단위">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={it.unit || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="수량">
                        <input
                          className="num-input"
                          type="number" min="0"
                          value={it.qty || ''}
                          onChange={(e) => updateField(it.id, { qty: e.target.value })}
                          onBlur={() => flushItem(it.id)}
                        />
                      </td>
                      <td data-label="단가">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={Number(it.unitPrice) ? Number(it.unitPrice).toLocaleString() : ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="합계" className="bom-cell-amount">
                        <input
                          type="text"
                          className="bom-readonly-input bom-amount-input"
                          value={amount.toLocaleString()}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="비고">
                        <input
                          type="text"
                          value={it.note || ''}
                          placeholder="-"
                          onChange={(e) => updateField(it.id, { note: e.target.value })}
                          onBlur={() => flushItem(it.id)}
                        />
                      </td>
                      <td className="bom-action-col">
                        <button
                          type="button"
                          className="closing-delete"
                          onClick={() => removeRow(it.id)}
                          aria-label="삭제"
                          title="삭제"
                        >✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="품목 선택">
        <p className="field-hint">구매 품목 관리에 등록된 품목 중에서 선택해 BOM에 추가합니다. 이미 BOM에 있는 품목은 목록에서 제외됩니다.</p>
        <div className="form-group">
          <input
            type="text"
            placeholder="코드 · 품명 · 규격 · 분류 검색"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="bom-picker-list">
          {filteredMaster.length === 0 ? (
            <p className="purchase-empty">
              {itemMaster.length === 0
                ? '등록된 품목이 없습니다. "구매 품목 관리"에서 먼저 품목을 등록하세요.'
                : (pickerSearch ? '검색 결과가 없습니다.' : '추가 가능한 품목이 없습니다 (모두 BOM에 포함됨).')}
            </p>
          ) : (
            filteredMaster.map((m) => (
              <label key={m.id} className={`bom-picker-row ${picked.has(m.id) ? 'is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={picked.has(m.id)}
                  onChange={() => togglePick(m.id)}
                />
                <span className="bom-picker-code">{m.code || '-'}</span>
                <span className="bom-picker-name">
                  <strong>{m.name}</strong>
                  {m.spec && <span className="bom-picker-spec"> ({m.spec})</span>}
                </span>
                {m.standardPrice > 0 && (
                  <span className="bom-picker-price">{Number(m.standardPrice).toLocaleString()}원</span>
                )}
              </label>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={addPickedToBom}
            disabled={picked.size === 0}
          >
            {picked.size}개 추가
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setPickerOpen(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
