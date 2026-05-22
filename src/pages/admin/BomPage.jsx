import { useState, useEffect, useMemo } from 'react';
import {
  getBomBySite, addBomItem, updateBomItem, deleteBomItem,
  getBomProjects, addBomProject, deleteBomProject,
} from '../../services/bomService';
import { getPurchaseItems } from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

const LS_KEY = 'bom-last-project-id';

export default function BomPage() {
  const { confirm, alert } = useDialog();
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null); // { id, name } | null
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);

  // 프로젝트 추가 모달
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  // 품목 선택 모달
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [im, ps] = await Promise.all([getPurchaseItems(), getBomProjects()]);
        setItemMaster(im);
        setProjects(ps);
        const savedId = (() => { try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; } })();
        if (savedId) {
          const found = ps.find((p) => p.id === savedId);
          if (found) setSelectedProject(found);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedProject) { setBomItems([]); return; }
    try { localStorage.setItem(LS_KEY, selectedProject.id); } catch { /* 무시 */ }
    getBomBySite(selectedProject.id).then(setBomItems).catch((err) => console.error(err));
  }, [selectedProject]);

  const masterMap = useMemo(() => {
    const m = {};
    itemMaster.forEach((it) => { m[it.id] = it; });
    return m;
  }, [itemMaster]);

  // 마스터 정보를 BOM 항목과 합쳐서 표시용 객체 생성 (마스터에 있으면 마스터값 우선)
  const displayItems = useMemo(() => bomItems.map((b) => {
    const m = b.itemId ? masterMap[b.itemId] : null;
    return {
      ...b,
      code: m?.code || b.code || '',
      name: m?.name || b.name || '',
      spec: m?.spec || b.spec || '',
      unit: m?.unit || b.unit || '',
    };
  }), [bomItems, masterMap]);

  const total = useMemo(
    () => displayItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
    [displayItems],
  );

  // ---- 프로젝트 추가 / 삭제 ----
  function openAddProject() {
    setNewProjectName('');
    setAddProjectOpen(true);
  }

  async function submitAddProject() {
    const name = newProjectName.trim();
    if (!name) { alert('프로젝트 이름을 입력하세요.'); return; }
    if (projects.some((p) => (p.name || '').trim().toLowerCase() === name.toLowerCase())) {
      alert('같은 이름의 프로젝트가 이미 있습니다.');
      return;
    }
    setAddingProject(true);
    try {
      const ref = await addBomProject(name);
      const created = { id: ref.id, name, createdAt: new Date() };
      setProjects((prev) => [created, ...prev]);
      setAddProjectOpen(false);
      setSelectedProject(created);
    } catch (err) {
      alert('프로젝트 추가 중 오류: ' + err.message);
    } finally {
      setAddingProject(false);
    }
  }

  async function handleDeleteProject(project) {
    if (!await confirm(`"${project.name}" 프로젝트와 등록된 BOM을 모두 삭제하시겠습니까?`)) return;
    try {
      await deleteBomProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        try { localStorage.removeItem(LS_KEY); } catch { /* 무시 */ }
      }
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  // ---- BOM 항목 편집 ----
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
    if (!await confirm(`"${item?.name || '이 항목'}"을(를) 삭제하시겠습니까?`)) return;
    try {
      await deleteBomItem(id);
      setBomItems((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  // ---- 품목 선택 모달 ----
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
        const ref = await addBomItem(selectedProject.id, data);
        added.push({ ...data, id: ref.id, siteId: selectedProject.id });
      } catch (err) {
        console.error(err);
      }
    }
    setBomItems((prev) => [...prev, ...added]);
    setPicked(new Set());
    setPickerOpen(false);
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  // ---- 프로젝트 목록 화면 ----
  if (!selectedProject) {
    return (
      <div className="bom-page">
        <div className="page-header">
          <h2>프로젝트별 BOM</h2>
          <div className="page-actions">
            <button type="button" className="btn btn-primary" onClick={openAddProject}>+ 프로젝트 추가</button>
          </div>
        </div>

        {projects.length === 0 ? (
          <p className="text-muted text-sm" style={{ padding: '12px 0' }}>
            등록된 프로젝트가 없습니다 — 우측 상단 "+ 프로젝트 추가"로 시작하세요.
          </p>
        ) : (
          <table className="table cards-sm">
            <thead>
              <tr>
                <th>프로젝트명</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td data-label="프로젝트명">
                    <button
                      type="button"
                      className="bom-project-link"
                      onClick={() => setSelectedProject(p)}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td>
                    <div className="btn-group">
                      <button className="btn btn-sm btn-outline" onClick={() => setSelectedProject(p)}>열기</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteProject(p)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 프로젝트 추가 모달 */}
        <Modal isOpen={addProjectOpen} onClose={() => setAddProjectOpen(false)} title="프로젝트 추가">
          <div className="form-group">
            <label>프로젝트 이름</label>
            <input
              type="text"
              value={newProjectName}
              placeholder="예: 2026 공장동 신축"
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitAddProject(); }}
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={submitAddProject}
              disabled={addingProject || !newProjectName.trim()}
            >
              {addingProject ? '추가 중…' : '추가'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setAddProjectOpen(false)}>취소</button>
          </div>
        </Modal>
      </div>
    );
  }

  // ---- BOM 상세 화면 (프로젝트 선택됨) ----
  return (
    <div className="bom-page">
      <div className="page-header">
        <div className="bom-detail-title">
          <button
            type="button"
            className="btn btn-outline bom-back-btn"
            onClick={() => setSelectedProject(null)}
          >← 프로젝트 목록</button>
          <h2>{selectedProject.name}</h2>
        </div>
      </div>

      <div className="bom-toolbar">
        <div className="bom-summary">
          <span>항목 <strong>{bomItems.length}</strong>건</span>
          <span>예상 합계 <strong>{total.toLocaleString()}원</strong></span>
        </div>
        <button type="button" className="btn btn-primary" onClick={openPicker} style={{ marginLeft: 'auto' }}>
          + 품목 불러오기
        </button>
      </div>

      <table className="table bom-table inline-edit-table cards-sm">
        <thead>
          <tr>
            <th style={{ width: 100 }}>코드</th>
            <th style={{ minWidth: 160 }}>품명</th>
            <th>규격</th>
            <th>단위</th>
            <th>수량</th>
            <th>단가</th>
            <th>합계</th>
            <th>메모</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {displayItems.length === 0 && (
            <tr><td colSpan={9} className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>
              품목이 없습니다 — 우측의 "+ 품목 불러오기"로 추가하세요.
            </td></tr>
          )}
          {displayItems.map((it) => {
            const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
            return (
              <tr key={it.id}>
                <td data-label="코드"><code className="bom-code">{it.code || '-'}</code></td>
                <td data-label="품명"><strong>{it.name}</strong></td>
                <td data-label="규격">{it.spec || '-'}</td>
                <td data-label="단위">{it.unit || '-'}</td>
                <td data-label="수량">
                  <input
                    type="number" min="0"
                    value={it.qty || ''}
                    onChange={(e) => updateField(it.id, { qty: e.target.value })}
                    onBlur={() => flushItem(it.id)}
                  />
                </td>
                <td data-label="단가">
                  <input
                    type="number" min="0"
                    value={it.unitPrice || ''}
                    onChange={(e) => updateField(it.id, { unitPrice: e.target.value })}
                    onBlur={() => flushItem(it.id)}
                  />
                </td>
                <td data-label="합계" className="bom-cell-amount">{amount.toLocaleString()}</td>
                <td data-label="메모">
                  <input
                    type="text"
                    value={it.note || ''}
                    onChange={(e) => updateField(it.id, { note: e.target.value })}
                    onBlur={() => flushItem(it.id)}
                  />
                </td>
                <td>
                  <div className="btn-group">
                    <button type="button" className="closing-delete" onClick={() => removeRow(it.id)} aria-label="삭제">✕</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 품목 선택 모달 */}
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
            <p className="text-muted text-sm" style={{ padding: 12, textAlign: 'center' }}>
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
