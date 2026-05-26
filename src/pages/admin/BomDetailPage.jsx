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
    <div className="bom-page printable-page">
      <div className="page-header screen-only">
        <div className="purchase-detail-header-left">
          <Link to="/admin/purchase/bom" className="purchase-back-link">← 프로젝트 목록</Link>
          <h2>{project.name}</h2>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={openPicker}>+ 품목 불러오기</button>
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

      {/* 인쇄 전용 IOPN_v4 양식 (자재 명세서) */}
      {(() => {
        const today = new Date();
        const docNo = `BOM${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        const todayKo = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
        const totalQty = rows.reduce((s, it) => s + (Number(it.qty) || 0), 0);
        const PRINT_ROWS = 15;
        const printRows = [...rows];
        while (printRows.length < PRINT_ROWS) printRows.push(null);
        const supplyAmount = total;
        const vat = Math.round(supplyAmount * 0.1);
        const grandTotal = supplyAmount + vat;
        return (
          <div className="print-form-iopn print-only">
            <div className="print-form-title">B O M  리 스 트</div>

            <table className="iopn-info-table">
              <tbody>
                <tr>
                  <th className="lbl">프로젝트명</th>
                  <td className="val">{project.name || ''}</td>
                  <th className="lbl">사업자등록번호</th>
                  <td className="val">222-81-36621</td>
                </tr>
                <tr>
                  <th className="lbl">문서번호</th>
                  <td className="val">{docNo}</td>
                  <th className="lbl">회사명/대표</th>
                  <td className="val">(주)아이오피엔 / 이종현</td>
                </tr>
                <tr>
                  <th className="lbl">작 성 일</th>
                  <td className="val">{todayKo}</td>
                  <th className="lbl">주 소</th>
                  <td className="val">충남 천안시 서북구 성환읍 율금1길 8-15</td>
                </tr>
                <tr>
                  <th className="lbl">항목 수</th>
                  <td className="val">{bomItems.length}건</td>
                  <th className="lbl">TEL/FAX</th>
                  <td className="val">041-415-0766 / 041-415-0767</td>
                </tr>
                <tr>
                  <th className="lbl">문서 종류</th>
                  <td className="val">BOM 리스트</td>
                  <th className="lbl">E-Mail</th>
                  <td className="val">iopn2024@naver.com</td>
                </tr>
                <tr>
                  <th className="lbl">용 도</th>
                  <td className="val">자재 산출 / 견적</td>
                  <th className="lbl">담당/연락처</th>
                  <td className="val">손성욱 / 010-7704-0331</td>
                </tr>
                <tr>
                  <td colSpan={4} className="iopn-amount-row">
                    예상 금액 : ₩ {supplyAmount.toLocaleString()}원 / VAT 별도
                  </td>
                </tr>
              </tbody>
            </table>

            <table className="iopn-items-table">
              <thead>
                <tr>
                  <th className="c-no">NO</th>
                  <th className="c-name">품목명</th>
                  <th className="c-spec">규격</th>
                  <th className="c-unit">단위</th>
                  <th className="c-qty">수량</th>
                  <th className="c-price">단가</th>
                  <th className="c-amount">금액</th>
                  <th className="c-note">비고</th>
                </tr>
              </thead>
              <tbody>
                {printRows.map((it, idx) => {
                  if (!it) return (
                    <tr key={`empty-${idx}`}>
                      <td className="c-no">{idx + 1}</td>
                      <td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                    </tr>
                  );
                  const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                  return (
                    <tr key={idx}>
                      <td className="c-no">{idx + 1}</td>
                      <td className="c-name">{it.name || ''}</td>
                      <td className="c-spec">{it.spec || ''}</td>
                      <td className="c-unit">{it.unit || ''}</td>
                      <td className="c-qty">{Number(it.qty) ? Number(it.qty).toLocaleString() : ''}</td>
                      <td className="c-price">{Number(it.unitPrice) ? Number(it.unitPrice).toLocaleString() : ''}</td>
                      <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                      <td className="c-note">{it.note || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <table className="iopn-notes-table">
              <tbody>
                <tr>
                  <th className="lbl">특이사항</th>
                  <td className="val"></td>
                </tr>
              </tbody>
            </table>

            <table className="iopn-total-table">
              <tbody>
                <tr>
                  <th className="lbl">수량</th>
                  <td className="num">{totalQty.toLocaleString()}</td>
                  <th className="lbl">공급가액</th>
                  <td className="num">{supplyAmount.toLocaleString()}</td>
                  <th className="lbl">VAT</th>
                  <td className="num">{vat.toLocaleString()}</td>
                  <th className="lbl">합계</th>
                  <td className="num grand">{grandTotal.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}

      <div className="purchase-filters bom-filters no-print">
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
                  <th className="bom-action-col no-print" aria-hidden="true"></th>
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
                      <td className="bom-action-col no-print">
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
