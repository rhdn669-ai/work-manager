import { useState, useEffect, useMemo, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getBomBySite, addBomItem, updateBomItem, deleteBomItem,
  getBomProjectById, updateBomProject,
} from '../../services/bomService';
import { getPurchaseItems, getSuppliers } from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';
import { specFontClass } from '../../utils/printText';

// 글자가 길면 PDF 1줄에 맞게 글자 크기 자동 축소
// 한글·CJK는 라틴보다 폭이 넓으므로 가중치(1.8배)를 줘서 더 일찍·더 작게 축소
export default function BomDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { confirm, alert } = useDialog();

  const [project, setProject] = useState(null);
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('order'); // 'order'(추가/붙여넣기순) | 'code'(코드순)
  const [groupBySupplier, setGroupBySupplier] = useState(false); // 구매처별 묶음 보기
  const [supplierFilter, setSupplierFilter] = useState(''); // 특정 구매처만 (이름)

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Map()); // itemId -> 수량
  // 코드 붙여넣기 일괄 선택
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState(null); // { added, already:[], notFound:[] }
  // 프로젝트명 수정
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [p, im, sp] = await Promise.all([
          getBomProjectById(projectId),
          getPurchaseItems(),
          getSuppliers(),
        ]);
        if (!p) {
          alert('해당 프로젝트를 찾을 수 없습니다.');
          navigate('/admin/purchase/bom');
          return;
        }
        const items = await getBomBySite(projectId);
        setProject(p);
        setItemMaster(im);
        setSuppliers(sp);
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

  const supplierMap = useMemo(() => {
    const m = {};
    suppliers.forEach((s) => { m[s.id] = s.name; });
    return m;
  }, [suppliers]);

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
      supplier: m?.defaultSupplierId ? (supplierMap[m.defaultSupplierId] || '') : '',
      // 단가는 마스터의 표준단가를 우선 표시 (마스터 변경 시 BOM도 자동 반영)
      unitPrice: m?.standardPrice ?? b.unitPrice ?? 0,
    };
  }), [bomItems, masterMap, supplierMap]);

  // 검색 + 구매처 필터 + 정렬
  const rows = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const kw = search.trim().toLowerCase();
    let list = kw
      ? displayItems.filter((it) =>
        [it.code, it.name, it.spec, it.maker, it.category, it.note]
          .some((v) => (v || '').toLowerCase().includes(kw)),
      )
      : displayItems;
    if (supplierFilter) {
      list = list.filter((it) => (it.supplier || '(구매처 미지정)') === supplierFilter);
    }
    const sorted = [...list];
    if (sortBy === 'code') {
      sorted.sort((a, b) => collator.compare(a.code || '', b.code || ''));
    } else {
      sorted.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    }
    return sorted;
  }, [displayItems, search, sortBy, supplierFilter]);

  // 화면에 보이는 구매처 목록 (필터 드롭다운용)
  const supplierOptions = useMemo(() => {
    const set = new Set(displayItems.map((it) => it.supplier || '(구매처 미지정)'));
    return [...set].sort();
  }, [displayItems]);

  // 구매처별 그룹 [{ name, items, subtotal }]
  const supplierGroups = useMemo(() => {
    const map = new Map();
    for (const it of rows) {
      const key = it.supplier || '(구매처 미지정)';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => ({
        name,
        items,
        subtotal: items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
      }));
  }, [rows]);

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
    setPicked(new Map());
    setPickerSearch('');
    setPasteOpen(false);
    setPasteText('');
    setPasteResult(null);
    setPickerOpen(true);
  }

  // 붙여넣은 코드 한 줄을 마스터 품목과 매칭 (코드/품명/규격 순, 괄호 메모·따옴표 무시)
  // ※ 다른 품목이 잘못 붙지 않도록 "부분 포함" 매칭은 하지 않음.
  //    띄어쓰기·하이픈(-) 차이 정도만 무시한 "완전 일치"까지만 허용.
  function findMasterByToken(token) {
    const norm = (v) => String(v || '').trim().toLowerCase().replace(/^["']+|["']+$/g, '');
    // 느슨한 정규화: 공백·하이픈·쉼표·괄호만 제거 (그 외 문자는 보존 → 다른 품목과 섞이지 않음)
    const loose = (v) => norm(v).replace(/[\s,()-]+/g, '');
    const t = norm(token);
    if (!t) return null;
    // 1차: 정확 일치 (코드 → 품명 → 규격)
    let hit = itemMaster.find((m) => norm(m.code) === t)
      || itemMaster.find((m) => norm(m.name) === t)
      || itemMaster.find((m) => norm(m.spec) === t);
    if (hit) return hit;
    // 2차: 괄호/뒤 메모 제거한 핵심 토큰으로 재시도
    const base = t.split('(')[0].trim();
    if (base && base !== t) {
      hit = itemMaster.find((m) => norm(m.code) === base)
        || itemMaster.find((m) => norm(m.name) === base)
        || itemMaster.find((m) => norm(m.spec) === base);
      if (hit) return hit;
    }
    // 3차: 띄어쓰기/하이픈 차이만 무시한 완전 일치 (부분 일치 아님)
    const lt = loose(base || t);
    if (lt) {
      hit = itemMaster.find((m) => loose(m.code) === lt)
        || itemMaster.find((m) => loose(m.name) === lt)
        || itemMaster.find((m) => loose(m.spec) === lt);
      if (hit) return hit;
    }
    return null;
  }

  // 붙여넣은 코드 목록을 "입력 순서 그대로" BOM에 바로 추가 (중복도 그대로 추가)
  async function applyPaste() {
    const lines = pasteText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const notFound = [];
    const matched = []; // { m, qty } — 입력 순서 유지, 중복 허용
    for (const line of lines) {
      // 줄 끝의 "공백/탭 + 숫자"를 수량으로 인식 (엑셀 2열 복사 = 탭 구분 포함).
      // 코드 끝 숫자(예: SS-130, 4797.0015)는 앞에 공백이 없어 수량으로 오인식되지 않음.
      const qm = line.match(/\s+(\d+(?:\.\d+)?)\s*$/);
      const qty = qm ? Number(qm[1]) : 0;
      const codeToken = qm ? line.slice(0, qm.index).trim() : line;
      if (!codeToken) continue; // 모델명 없이 숫자만 있는 빈 줄은 건너뜀
      const m = findMasterByToken(codeToken);
      if (!m) { notFound.push(line); continue; }
      matched.push({ m, qty: qty > 0 ? qty : 1 });
    }
    if (matched.length === 0) { setPasteResult({ added: 0, notFound }); return; }
    let nextOrder = bomItems.length === 0
      ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    const added = [];
    for (const { m, qty } of matched) {
      const data = {
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        qty,
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
    setPasteText('');
    setPasteResult({ added: added.length, notFound });
  }

  function togglePick(itemId) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(itemId)) next.delete(itemId); else next.set(itemId, 1); // 체크 시 기본 수량 1
      return next;
    });
  }

  // 선택한 품목의 수량 입력값 변경
  function setPickQty(itemId, value) {
    setPicked((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.set(itemId, value);
      return next;
    });
  }

  const filteredMaster = useMemo(() => {
    const kw = pickerSearch.trim().toLowerCase();
    const inBomIds = new Set(bomItems.map((b) => b.itemId).filter(Boolean));
    // 대분류(베어 메인) 제외: 코드 형식 + 하위 품목의 groupKey가 가리키는 id 양쪽으로
    const mainIds = new Set(itemMaster.map((m) => m.groupKey).filter(Boolean));
    let list = itemMaster.filter(
      (m) => !inBomIds.has(m.id) && !/^IOPN-\d+$/.test(m.code || '') && !mainIds.has(m.id),
    );
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
    for (const [itemId, qtyInput] of picked) {
      const m = masterMap[itemId];
      if (!m) continue;
      const data = {
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        qty: Number(qtyInput) || 0,
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
    setPicked(new Map());
    setPickerOpen(false);
  }

  // 모달에서 Enter → 추가 실행 (선택된 항목이 있을 때만)
  function handlePickerSubmit(e) {
    e.preventDefault();
    if (picked.size > 0) addPickedToBom();
  }

  // 프로젝트명 수정
  function openNameModal() {
    setNameInput(project?.name || '');
    setNameModalOpen(true);
  }
  async function saveName() {
    const n = nameInput.trim();
    if (!n) return;
    try {
      await updateBomProject(projectId, n);
      setProject((p) => ({ ...p, name: n }));
      setNameModalOpen(false);
    } catch (err) {
      alert('프로젝트명 수정 오류: ' + err.message);
    }
  }

  if (loading || !project) return <div className="loading">로딩 중...</div>;

  return (
    <div className="bom-page printable-page">
      <div className="page-header screen-only">
        <div className="bom-title-wrap">
          <h2>{project.name}</h2>
          <button type="button" className="bom-title-edit" onClick={openNameModal} title="프로젝트명 수정" aria-label="프로젝트명 수정">✏️</button>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={openPicker}>+ 품목 불러오기</button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('/admin/purchase/bom')}>목록</button>
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
        // 페이지 직접 분할 (구매처 밴드·섹션 경계 표기를 위해 브라우저 자동 분할 대신)
        const FIRST_PAGE_ROWS = 19; // 1페이지는 상단 정보표가 있어 적게
        const OTHER_PAGE_ROWS = 26;
        const pageData = [];
        const pushPages = (list, secName) => {
          let i = 0;
          while (i < list.length) {
            const size = pageData.length === 0 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
            const chunk = list.slice(i, i + size);
            pageData.push({
              chunk, startNo: i, size,
              supplierName: secName,
              isSectionLast: (i + size) >= list.length,
            });
            i += size;
          }
        };
        // 구매처별이면 구매처 순서대로 정렬해 연속 출력 (페이지 분할 X)
        const printRows = groupBySupplier ? supplierGroups.flatMap((g) => g.items) : rows;
        pushPages(printRows, null);
        if (pageData.length === 0) pageData.push({ chunk: [], startNo: 0, size: FIRST_PAGE_ROWS, supplierName: null, isSectionLast: true });
        const pageCount = pageData.length;
        return (
          <div className="print-form-iopn print-form-paged print-only">
            {pageData.map(({ chunk, startNo, size, supplierName, isSectionLast }, pageIdx) => {
              const isFirst = pageIdx === 0;
              const targetRows = size;
              const padded = [...chunk];
              while (padded.length < targetRows) padded.push(null);
              return (
                <div className="bom-print-page" key={pageIdx}>
                  {isFirst ? (
                    <>
                      <div className="print-form-title bom-list-title">BOM 리스트</div>

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
              </tbody>
            </table>
                    </>
                  ) : null}

                  {supplierName && (
                    <div className="bom-print-supplier-band">구매처 : {supplierName}</div>
                  )}

                  <table className="iopn-items-table bom-no-price">
                    <thead>
                      <tr>
                        <th className="c-no">NO</th>
                        <th className="c-name">품목명</th>
                        <th className="c-spec">규격</th>
                        <th className="c-qty">수량</th>
                        <th className="c-supplier">구매처</th>
                        <th className="c-note">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {padded.map((it, r) => {
                        if (!it) return (
                          <tr key={`e-${r}`}>
                            <td className="c-no"></td>
                            <td></td><td></td><td></td><td></td><td></td>
                          </tr>
                        );
                        return (
                          <tr key={r}>
                            <td className="c-no">{startNo + r + 1}</td>
                            <td className={`c-name ${specFontClass(it.name, 13)}`}>{it.name || ''}</td>
                            <td className={`c-spec ${specFontClass(it.spec, 43)}`}>{it.spec || ''}</td>
                            <td className="c-qty">{Number(it.qty) ? Number(it.qty).toLocaleString() : ''}</td>
                            <td className={`c-supplier ${specFontClass(it.supplier, 18)}`}>{it.supplier || ''}</td>
                            <td className={`c-note ${specFontClass(it.note, 14)}`}>{it.note || ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {isSectionLast && (
                    <table className="iopn-notes-table">
                      <tbody>
                        <tr>
                          <th className="lbl">특이사항</th>
                          <td className="val"></td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  <div className="bom-print-footer">
                    <span>(주)아이오피엔 · BOM 리스트 · {docNo}</span>
                    <span>페이지 {pageIdx + 1} / {pageCount}</span>
                  </div>
                </div>
              );
            })}
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
        <div className="bom-sort" role="group" aria-label="정렬 방식">
          <button
            type="button"
            className={`btn btn-sm ${sortBy === 'order' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setSortBy('order')}
          >추가순</button>
          <button
            type="button"
            className={`btn btn-sm ${sortBy === 'code' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setSortBy('code')}
          >코드순</button>
        </div>
        <button
          type="button"
          className={`btn btn-sm ${groupBySupplier ? 'btn-primary' : 'btn-outline'}`}
          onClick={() => setGroupBySupplier((v) => !v)}
          title="구매처별로 묶어서 보기/출력"
        >구매처별 {groupBySupplier ? 'ON' : 'OFF'}</button>
        <select
          className="bom-supplier-select"
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">구매처 전체</option>
          {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="bom-summary">
          <span>항목 <strong>{bomItems.length}</strong>건</span>
          <span>예상 합계 <strong>{total.toLocaleString()}원</strong></span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="purchase-empty screen-only">
          {bomItems.length === 0
            ? '품목이 없습니다 — 우측 상단 "+ 품목 불러오기"로 추가하세요.'
            : '검색 조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <div className="item-group is-expanded bom-flat-group screen-only">
          <div className="item-group-detail">
            <table className="table inline-edit-table cards-sm bom-flat-table">
              <thead>
                <tr>
                  <th className="bom-spacer-col" aria-hidden="true"></th>
                  <th className="bom-no-col">No</th>
                  <th style={{ minWidth: 100 }}>코드</th>
                  <th style={{ minWidth: 160 }}>품명</th>
                  <th>메이커</th>
                  <th>규격</th>
                  <th>분류</th>
                  <th>수량</th>
                  <th>단가</th>
                  <th>합계</th>
                  <th>구매처</th>
                  <th style={{ minWidth: 160 }}>비고</th>
                  <th className="bom-action-col no-print" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {(groupBySupplier ? supplierGroups.flatMap((g) => g.items) : rows).map((it, idx, arr) => {
                  const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                  const sup = it.supplier || '(구매처 미지정)';
                  const prevSup = idx > 0 ? (arr[idx - 1].supplier || '(구매처 미지정)') : null;
                  const nextSup = idx < arr.length - 1 ? (arr[idx + 1].supplier || '(구매처 미지정)') : null;
                  const isGroupStart = groupBySupplier && sup !== prevSup;
                  const isGroupEnd = groupBySupplier && sup !== nextSup;
                  const grp = isGroupEnd ? supplierGroups.find((g) => g.name === sup) : null;
                  return (
                    <Fragment key={it.id}>
                    {isGroupStart && (
                      <tr className="bom-supplier-header">
                        <td className="bom-spacer-col" aria-hidden="true"></td>
                        <td colSpan={12}>🏷 {sup}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="bom-spacer-col" aria-hidden="true"></td>
                      <td className="bom-no-col" data-label="No">{idx + 1}</td>
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
                      <td data-label="구매처">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={it.supplier || ''}
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
                    {isGroupEnd && grp && (
                      <tr className="bom-supplier-subtotal">
                        <td className="bom-spacer-col" aria-hidden="true"></td>
                        <td colSpan={8} style={{ textAlign: 'right' }}>{sup} 소계</td>
                        <td>{grp.subtotal.toLocaleString()}원</td>
                        <td colSpan={3}></td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="품목 선택">
        <form onSubmit={handlePickerSubmit}>
        <p className="field-hint">구매 품목 관리에 등록된 품목 중에서 선택해 BOM에 추가합니다. 이미 BOM에 있는 품목은 목록에서 제외됩니다.</p>

        {/* 코드 여러 개 붙여넣기 → 자동 선택 */}
        <div className="bom-paste-box">
          <button
            type="button"
            className="bom-paste-toggle"
            onClick={() => setPasteOpen((v) => !v)}
          >
            {pasteOpen ? '▴ 코드 붙여넣기 닫기' : '▾ 코드(+수량) 여러 개 붙여넣어 한 번에 추가'}
          </button>
          {pasteOpen && (
            <div className="bom-paste-panel">
              <textarea
                className="bom-paste-textarea"
                rows={5}
                placeholder={'코드를 한 줄에 하나씩. 코드 뒤에 수량을 적으면 함께 인식됩니다.\n(엑셀에서 모델명·수량 2개 열을 그대로 복사해 붙여넣어도 됩니다)\n예)\nNV50-SVFU-2P 2\nSCK12-2R 4\nDE-15F (2열,땜) 1'}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <div className="bom-paste-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={applyPaste}
                  disabled={!pasteText.trim()}
                >코드로 찾아 추가</button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => { setPasteText(''); setPasteResult(null); }}
                >지우기</button>
              </div>
              {pasteResult && (
                <div className="bom-paste-result">
                  <span className="ok">✅ {pasteResult.added}개 추가됨</span>
                  {pasteResult.notFound.length > 0 && (
                    <div className="miss">
                      ⚠️ 못 찾은 코드 {pasteResult.notFound.length}개:
                      <ul className="miss-list">
                        {pasteResult.notFound.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="form-group">
          <input
            type="text"
            placeholder="코드 · 품명 · 규격 · 분류 검색"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
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
                {picked.has(m.id) && (
                  <span
                    className="bom-picker-qty-wrap"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  >
                    <input
                      type="number"
                      min="0"
                      className="num-input bom-picker-qty"
                      value={picked.get(m.id)}
                      onChange={(e) => setPickQty(m.id, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      autoFocus
                      aria-label={`${m.name} 수량`}
                    />
                    <span className="bom-picker-qty-unit">{m.unit || '개'}</span>
                  </span>
                )}
              </label>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={picked.size === 0}
          >
            {picked.size}개 추가
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setPickerOpen(false)}>취소</button>
        </div>
        </form>
      </Modal>

      <Modal isOpen={nameModalOpen} onClose={() => setNameModalOpen(false)} title="프로젝트명 수정">
        <div className="form-group">
          <label>프로젝트명</label>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && nameInput.trim()) saveName(); }}
            placeholder="프로젝트명 입력"
            autoFocus
            maxLength={60}
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={!nameInput.trim()} onClick={saveName}>저장</button>
          <button type="button" className="btn btn-outline" onClick={() => setNameModalOpen(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
