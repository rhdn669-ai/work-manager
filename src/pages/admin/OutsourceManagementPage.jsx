import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getFreelancers, addFreelancer, updateFreelancer, deleteFreelancer,
  getVendors, addVendor, updateVendor, deleteVendor,
  importFromSiteClosings, getVendorDetail,
  addFreelancerToVendor,
  addVendorProject, removeVendorProject,
  setFreelancerRate, clearAllRateHistories,
  removeRateHistoryByFields,
  getAllClosingItems,
} from '../../services/outsourceService';
import { getAllSites } from '../../services/siteService';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';

export default function OutsourceManagementPage() {
  const { isAdmin, canViewSalary } = useAuth();
  const [tab, setTab] = useState('freelancer'); // 'freelancer' | 'daily' | 'vendor'
  const [freelancers, setFreelancers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [closingItems, setClosingItems] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  // 월별 집계 필터
  const nowRef = new Date();
  const [filterMode, setFilterMode] = useState('month'); // 'month' | 'all'
  const [filterYear, setFilterYear] = useState(nowRef.getFullYear());
  const [filterMonth, setFilterMonth] = useState(nowRef.getMonth() + 1);
  // 인원별 집계 모달 + 개별 상세 모달
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [detailFor, setDetailFor] = useState(null); // { kind: 'freelancer'|'daily'|'vendor', name }
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [detailVendor, setDetailVendor] = useState(null);
  const [detailTab, setDetailTab] = useState('freelancers');
  const [detailLoading, setDetailLoading] = useState(false);
  const [newFreelancer, setNewFreelancer] = useState({ name: '', dailyRate: 0 });
  const newFreelancerNameRef = useRef(null);
  const [newProject, setNewProject] = useState({ name: '', unitPrice: 0 });
  const [detailBusy, setDetailBusy] = useState(false);
  const [editRateFor, setEditRateFor] = useState(null); // freelancer id
  const [openHistoryFor, setOpenHistoryFor] = useState({}); // { [freelancerId]: true/false }
  const nowForRate = new Date();
  const [rateEdit, setRateEdit] = useState({
    year: nowForRate.getFullYear(),
    month: nowForRate.getMonth() + 1,
    rate: 0,
  });

  function openRateEdit(f) {
    const now = new Date();
    const [y, m] = (f.dailyRateFrom || '').split('-');
    setRateEdit({
      year: y ? Number(y) : now.getFullYear(),
      month: m ? Number(m) : now.getMonth() + 1,
      rate: f.dailyRate || 0,
    });
    setEditRateFor(f.id);
  }

  async function handleSaveRate(freelancerId) {
    if (!rateEdit.year || !rateEdit.month) { alert('적용 년/월을 선택해주세요.'); return; }
    if (!rateEdit.rate || Number(rateEdit.rate) <= 0) { alert('단가를 입력해주세요.'); return; }
    const effectiveFromMonth = `${rateEdit.year}-${String(rateEdit.month).padStart(2, '0')}-01`;
    setDetailBusy(true);
    try {
      await setFreelancerRate(freelancerId, {
        dailyRate: rateEdit.rate,
        effectiveFromMonth,
      });
      setEditRateFor(null);
      await reloadDetail();
    } catch (err) {
      alert('단가 저장 실패: ' + err.message);
    } finally {
      setDetailBusy(false);
    }
  }

  async function openVendorDetail(v) {
    setDetailVendor({ ...v, freelancers: [], projects: [] });
    setDetailTab('freelancers');
    setNewFreelancer({ name: '', dailyRate: v.dailyRate || 0 });
    setNewProject({ name: '', unitPrice: v.caseRate || 0 });
    setDetailLoading(true);
    try {
      const detail = await getVendorDetail(v.id, v.name);
      setDetailVendor((prev) => prev ? { ...prev, freelancers: detail.freelancers, projects: detail.projects } : null);
    } catch (err) {
      alert('상세 조회 실패: ' + err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function reloadDetail() {
    if (!detailVendor) return;
    const detail = await getVendorDetail(detailVendor.id, detailVendor.name);
    setDetailVendor((prev) => prev ? { ...prev, freelancers: detail.freelancers, projects: detail.projects } : null);
    await loadAll();
  }

  async function handleAddFreelancerToVendor(e) {
    e.preventDefault();
    if (!newFreelancer.name?.trim()) { alert('이름을 입력해주세요.'); return; }
    setDetailBusy(true);
    try {
      await addFreelancerToVendor(detailVendor.name, {
        name: newFreelancer.name.trim(),
        dailyRate: Number(newFreelancer.dailyRate) || 0,
      });
      setNewFreelancer({ name: '', dailyRate: detailVendor.dailyRate || 0 });
      await reloadDetail();
      // 다음 직원 이름을 바로 입력할 수 있도록 이름 input에 재포커스 → IME가 한글 모드로 복귀
      setTimeout(() => { newFreelancerNameRef.current?.focus(); }, 0);
    } catch (err) {
      alert('직원 추가 실패: ' + err.message);
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleAddProject(e) {
    e.preventDefault();
    const name = newProject.name.trim();
    if (!name) { alert('프로젝트명을 입력해주세요.'); return; }
    if ((detailVendor.projects || []).some((p) => p.name === name)) { alert('이미 등록된 프로젝트입니다.'); return; }
    setDetailBusy(true);
    try {
      await addVendorProject(detailVendor.id, { name, unitPrice: newProject.unitPrice });
      setNewProject({ name: '', unitPrice: detailVendor.caseRate || 0 });
      await reloadDetail();
    } catch (err) {
      alert('프로젝트 추가 실패: ' + err.message);
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleRemoveProject(project) {
    if (!confirm(`"${project.name}"을(를) 삭제하시겠습니까?`)) return;
    setDetailBusy(true);
    try {
      await removeVendorProject(detailVendor.id, project);
      await reloadDetail();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleImport() {
    if (!confirm('모든 프로젝트 공수표에서 프리랜서·업체 정보를 가져옵니다.\n기존 외주관리에 없는 항목만 추가됩니다.\n\n계속하시겠습니까?')) return;
    setImporting(true);
    try {
      const stats = await importFromSiteClosings();
      alert(
        `가져오기 완료\n\n` +
        `프리랜서 추가: ${stats.freelancersAdded}명 (기존 유지 ${stats.freelancersSkipped}명)\n` +
        `업체 추가: ${stats.vendorsAdded}개 (기존 유지 ${stats.vendorsSkipped}개)`
      );
      await loadAll();
    } catch (err) {
      alert('가져오기 실패: ' + err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleClearHistories() {
    if (!confirm('모든 프리랜서의 단가 변경 이력을 초기화합니다.\n현재 단가는 유지되고, 이전 단가 기록만 전부 삭제됩니다.\n되돌릴 수 없습니다.\n\n계속하시겠습니까?')) return;
    setClearing(true);
    try {
      const count = await clearAllRateHistories();
      alert(`단가 이력 초기화 완료 (${count}명)`);
      await loadAll();
    } catch (err) {
      alert('초기화 실패: ' + err.message);
    } finally {
      setClearing(false);
    }
  }

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin]);

  async function loadAll() {
    setLoading(true);
    try {
      const [fs, vs, cs, ss] = await Promise.all([getFreelancers(), getVendors(), getAllClosingItems(), getAllSites()]);
      setFreelancers(fs);
      setVendors(vs);
      setClosingItems(cs);
      setSites(ss);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  function shiftFilterMonth(delta) {
    let y = filterYear;
    let m = filterMonth + delta;
    if (m < 1) { m = 12; y -= 1; }
    else if (m > 12) { m = 1; y += 1; }
    setFilterYear(y);
    setFilterMonth(m);
  }

  function openCreate() {
    setEditItem(null);
    if (tab === 'vendor') {
      setForm({ name: '', representative: '', contact: '', businessNumber: '', bankName: '', bankAccount: '' });
    } else {
      // freelancer / daily 공통 (workerType만 탭에 맞게 설정)
      setForm({ name: '', vendor: '', dailyRate: 0, contact: '', note: '', workerType: tab });
    }
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ ...item });
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name?.trim()) { alert('이름을 입력해주세요.'); return; }
    try {
      if (tab === 'vendor') {
        if (editItem) await updateVendor(editItem.id, form);
        else await addVendor(form);
      } else {
        // freelancer / daily
        const payload = { ...form, workerType: form.workerType || tab };
        if (editItem) await updateFreelancer(editItem.id, payload);
        else await addFreelancer(payload);
      }
      setShowModal(false);
      await loadAll();
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  }

  async function handleDelete(item) {
    const label = tab === 'vendor' ? '업체' : tab === 'daily' ? '일용직' : '프리랜서';
    if (!confirm(`"${item.name}" ${label}를 삭제하시겠습니까?`)) return;
    try {
      if (tab === 'vendor') await deleteVendor(item.id);
      else await deleteFreelancer(item.id);
      await loadAll();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

  if (!isAdmin) return <div className="card"><div className="card-body empty-state">접근 권한이 없습니다.</div></div>;

  // 업체 소속이 없는 개인 인력만 프리랜서/일용직 탭에 표시 (workerType 미지정은 freelancer로 간주)
  const soloFreelancers = freelancers.filter((f) => !(f.vendor || '').trim() && (f.workerType || 'freelancer') === 'freelancer');
  const soloDailies = freelancers.filter((f) => !(f.vendor || '').trim() && f.workerType === 'daily');

  // 선택된 기간 필터 — 월별 / 전체
  const filteredItems = filterMode === 'month'
    ? closingItems.filter((it) => Number(it.year) === filterYear && Number(it.month) === filterMonth)
    : closingItems;

  // 탭별 지출 합계 (선택된 기간 기준)
  const sumByItemTypes = (types, list = filteredItems) => list
    .filter((it) => types.includes(it.itemType))
    .reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const freelancerSpend = sumByItemTypes(['freelancer']);
  const dailySpend = sumByItemTypes(['daily']);
  const vendorSpend = sumByItemTypes(['vendor', 'vendor_case']);

  const fmtMoney = (n) => `${Number(n || 0).toLocaleString()}원`;
  const currentSpend = tab === 'freelancer' ? freelancerSpend : tab === 'daily' ? dailySpend : vendorSpend;
  const currentTabTypes = tab === 'freelancer' ? ['freelancer'] : tab === 'daily' ? ['daily'] : ['vendor', 'vendor_case'];
  const currentTabLabel = tab === 'freelancer' ? '프리랜서' : tab === 'daily' ? '일용직' : '업체';
  const periodLabel = filterMode === 'month' ? `${filterYear}년 ${filterMonth}월` : '전체 기간';
  const siteNameMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));

  // 현재 탭 기간별 공수표 항목 집합 (인원/업체별 집계용)
  const currentTabItems = filteredItems.filter((it) => currentTabTypes.includes(it.itemType));

  // 인원/업체별 집계 — key = 이름(freelancer/daily) 또는 업체명(vendor)
  const groupKey = (it) => (tab === 'vendor' ? (it.vendor || '(미지정)') : (it.detail || '(이름없음)'));
  const groupLabel = tab === 'vendor' ? '업체명' : '이름';
  const perPerson = Object.values(
    currentTabItems
      .filter((it) => Number(it.amount) > 0) // 금액 0은 집계 모달에서 제외
      .reduce((acc, it) => {
        const k = groupKey(it);
        if (!acc[k]) acc[k] = { key: k, total: 0, count: 0 };
        acc[k].total += Number(it.amount) || 0;
        acc[k].count += 1;
        return acc;
      }, {})
  ).sort((a, b) => b.total - a.total);

  return (
    <div className="outsource-management-page">
      <div className="page-header">
        <h2>외주 관리</h2>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={openCreate}>
            {tab === 'vendor' ? '+ 업체' : tab === 'daily' ? '+ 일용직' : '+ 프리랜서'} 추가
          </button>
        </div>
      </div>

      <div className="tab-nav" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'freelancer' ? 'active' : ''}`}
          onClick={() => setTab('freelancer')}
        >
          프리랜서 {soloFreelancers.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{soloFreelancers.length}</span>}
        </button>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'daily' ? 'active' : ''}`}
          onClick={() => setTab('daily')}
        >
          일용직 {soloDailies.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{soloDailies.length}</span>}
        </button>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'vendor' ? 'active' : ''}`}
          onClick={() => setTab('vendor')}
        >
          업체 {vendors.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{vendors.length}</span>}
        </button>
      </div>

      {/* 탭별 지출 합계 — 월별 필터 + 인원별 상세 진입 */}
      {canViewSalary && !loading && (
        <div className="outsource-spend-panel">
          <div className="outsource-spend-filter">
            <div className="outsource-spend-filter-tabs">
              <button
                type="button"
                className={`outsource-filter-btn ${filterMode === 'month' ? 'active' : ''}`}
                onClick={() => setFilterMode('month')}
              >월별</button>
              <button
                type="button"
                className={`outsource-filter-btn ${filterMode === 'all' ? 'active' : ''}`}
                onClick={() => setFilterMode('all')}
              >전체</button>
            </div>
            {filterMode === 'month' && (
              <div className="outsource-spend-month-nav">
                <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftFilterMonth(-1)} aria-label="이전 달">‹</button>
                <span className="outsource-spend-ym">{filterYear}년 {filterMonth}월</span>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftFilterMonth(1)} aria-label="다음 달">›</button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="outsource-spend-summary is-clickable"
            onClick={() => perPerson.length > 0 && setSummaryModalOpen(true)}
            disabled={perPerson.length === 0}
            title={perPerson.length > 0 ? `${currentTabLabel} 인원별 상세 보기` : '해당 기간 지출 없음'}
          >
            <span className="outsource-spend-summary-label">{currentTabLabel} 지출 · {periodLabel}</span>
            <strong className="outsource-spend-summary-amount">{fmtMoney(currentSpend)}</strong>
            {perPerson.length > 0 && (
              <span className="outsource-spend-summary-sub">
                {perPerson.length}명 · 클릭하여 인원별 보기 →
              </span>
            )}
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : (tab === 'freelancer' || tab === 'daily') ? (
        (tab === 'freelancer' ? soloFreelancers : soloDailies).length === 0 ? (
          <div className="card"><div className="card-body empty-state">
            {tab === 'freelancer'
              ? '등록된 개인 프리랜서가 없습니다. (업체 소속 직원은 업체 상세에서 관리)'
              : '등록된 일용직이 없습니다.'}
          </div></div>
        ) : (
          <table className="table table-clickable">
            <thead>
              <tr>
                <th>이름</th>
                <th>{tab === 'daily' ? '시급' : '일당'}</th>
                <th>연락처</th>
                <th>비고</th>
                <th style={{ width: 1, whiteSpace: 'nowrap' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {(tab === 'freelancer' ? soloFreelancers : soloDailies).map((f) => (
                <tr
                  key={f.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setDetailFor({ kind: tab, name: f.name })}
                  title={`${f.name} 공수표 상세 내역 보기`}
                >
                  <td><strong>{f.name}</strong></td>
                  <td>{f.dailyRate ? `${Number(f.dailyRate).toLocaleString()}원` : '-'}</td>
                  <td>{f.contact || '-'}</td>
                  <td style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.note || '-'}</td>
                  <td onClick={(e) => e.stopPropagation()} className="outsource-actions-cell">
                    <div className="outsource-action-btns">
                      <button type="button" className="outsource-icon-btn" onClick={() => openEdit(f)} title="수정" aria-label="수정">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button type="button" className="outsource-icon-btn is-danger" onClick={() => handleDelete(f)} title="삭제" aria-label="삭제">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : (
        vendors.length === 0 ? (
          <div className="card"><div className="card-body empty-state">등록된 업체가 없습니다.</div></div>
        ) : (
          <table className="table table-clickable">
            <thead>
              <tr>
                <th>업체명</th>
                <th>대표자</th>
                <th>연락처</th>
                <th>사업자번호</th>
                <th>은행</th>
                <th>계좌</th>
                <th style={{ width: 1, whiteSpace: 'nowrap' }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr
                  key={v.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setDetailFor({ kind: 'vendor', name: v.name })}
                  title={`${v.name} 지출 상세 내역 보기`}
                >
                  <td><strong>{v.name}</strong></td>
                  <td>{v.representative || '-'}</td>
                  <td>{v.contact || '-'}</td>
                  <td>{v.businessNumber || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.bankName || '-'}</td>
                  <td style={{ maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.bankAccount || '-'}</td>
                  <td onClick={(e) => e.stopPropagation()} className="outsource-actions-cell">
                    <div className="outsource-action-btns">
                      <button type="button" className="outsource-icon-btn" onClick={() => openVendorDetail(v)} title="소속·프로젝트" aria-label="소속·프로젝트 보기">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                          <circle cx="9" cy="7" r="4"/>
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                      </button>
                      <button type="button" className="outsource-icon-btn" onClick={() => openEdit(v)} title="수정" aria-label="수정">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button type="button" className="outsource-icon-btn is-danger" onClick={() => handleDelete(v)} title="삭제" aria-label="삭제">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={`${tab === 'vendor' ? '업체' : tab === 'daily' ? '일용직' : '프리랜서'} ${editItem ? '수정' : '추가'}`}
      >
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>이름 *</label>
            <input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder={tab === 'vendor' ? '○○ 산업' : '홍길동'}
              lang="ko"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {tab !== 'vendor' ? (
            <>
              <div className="form-group">
                <label>{tab === 'daily' ? '시급' : '일당'}</label>
                <MoneyInput
                  value={form.dailyRate || 0}
                  onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>대표자 이름</label>
                <input
                  value={form.representative || ''}
                  onChange={(e) => setForm({ ...form, representative: e.target.value })}
                  placeholder="대표자 성함"
                  lang="ko"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="form-group">
                <label>연락처</label>
                <input
                  value={form.contact || ''}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  placeholder="010-0000-0000"
                  inputMode="tel"
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label>사업자번호</label>
                <input
                  value={form.businessNumber || ''}
                  onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
                  placeholder="000-00-00000"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>은행명</label>
                  <input
                    value={form.bankName || ''}
                    onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                    placeholder="예: 국민은행"
                    lang="ko"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label>계좌번호</label>
                  <input
                    value={form.bankAccount || ''}
                    onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
                    placeholder="계좌번호 · 예금주"
                    autoComplete="off"
                  />
                </div>
              </div>
            </>
          )}
          {tab !== 'vendor' && (
            <>
              <div className="form-group">
                <label>연락처</label>
                <input
                  value={form.contact || ''}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  placeholder="010-0000-0000"
                />
              </div>
              <div className="form-group">
                <label>비고</label>
                <textarea
                  rows={2}
                  value={form.note || ''}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
            </>
          )}
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editItem ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>

      {/* 인원별 집계 모달 — 상단 카드 클릭 시 */}
      {summaryModalOpen && (
        <Modal
          isOpen={summaryModalOpen}
          onClose={() => setSummaryModalOpen(false)}
          title={`${currentTabLabel} · ${periodLabel} 인원별 지출`}
        >
          <div className="outsource-pp-summary">
            <div className="outsource-pp-total">
              <span>합계</span>
              <strong>{fmtMoney(currentSpend)}</strong>
            </div>
            {perPerson.length === 0 ? (
              <p className="empty-state">해당 기간 지출 내역이 없습니다.</p>
            ) : (
              <ul className="outsource-pp-list">
                {perPerson.map((p) => (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => {
                        setSummaryModalOpen(false);
                        setDetailFor({ kind: tab, name: p.key });
                      }}
                    >
                      <div className="outsource-pp-name">
                        <strong>{p.key}</strong>
                        <span className="outsource-pp-count">{p.count}건</span>
                      </div>
                      <span className="outsource-pp-amount">{fmtMoney(p.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {/* 개별 상세 내역 모달 — 이름/업체 행 클릭 시 */}
      {detailFor && (() => {
        const types = detailFor.kind === 'vendor' ? ['vendor', 'vendor_case'] : [detailFor.kind];
        const matcher = (it) => types.includes(it.itemType) && (
          detailFor.kind === 'vendor'
            ? (it.vendor || '') === detailFor.name
            : (it.detail || '') === detailFor.name
        );
        const all = closingItems.filter(matcher).filter((it) => Number(it.amount) > 0);
        const totalAmt = all.reduce((s, it) => s + (Number(it.amount) || 0), 0);
        // 최신순 정렬
        const sorted = [...all].sort((a, b) => {
          const d = Number(b.year) * 100 + Number(b.month) - Number(a.year) * 100 - Number(a.month);
          return d !== 0 ? d : (a.no || 0) - (b.no || 0);
        });
        const kindLabel = detailFor.kind === 'vendor' ? '업체' : detailFor.kind === 'daily' ? '일용직' : '프리랜서';
        const isVendorTab = detailFor.kind === 'vendor';
        return (
          <Modal
            isOpen={!!detailFor}
            onClose={() => setDetailFor(null)}
            title={`${detailFor.name} · ${kindLabel} 지출 상세`}
          >
            <div className="outsource-pp-summary">
              <div className="outsource-pp-total">
                <span>총 지출 (전체 기간)</span>
                <strong>{fmtMoney(totalAmt)}</strong>
              </div>
              {sorted.length === 0 ? (
                <p className="empty-state">지출 기록이 없습니다.</p>
              ) : (
                <ul className="outsource-detail-list">
                  {sorted.map((it) => {
                    const siteName = siteNameMap[it.siteId] || '(삭제된 프로젝트)';
                    const qty = Number(it.quantity || 0);
                    const unit = it.itemType === 'daily' ? '시간' : it.itemType === 'vendor_case' ? '건' : '일';
                    // 품목/이름 라벨: 업체 탭이면 detail=직원명 or 프로젝트명, 프리랜서/일용직 탭이면 vendor=소속업체(있을 때)
                    const itemLabel = isVendorTab
                      ? (it.detail || (it.itemType === 'vendor_case' ? '프로젝트 미지정' : '직원 미지정'))
                      : (it.vendor || '');
                    const itemKind = isVendorTab
                      ? (it.itemType === 'vendor_case' ? '프로젝트' : '직원')
                      : (it.vendor ? '소속 업체' : '');
                    return (
                      <li key={it.id}>
                        <div className="outsource-detail-head">
                          <strong>{it.year}년 {it.month}월</strong>
                          <span className="outsource-detail-site">{siteName}</span>
                        </div>
                        {itemLabel && (
                          <div className="outsource-detail-item">
                            {itemKind && <span className="outsource-detail-kind">{itemKind}</span>}
                            <strong className="outsource-detail-name">{itemLabel}</strong>
                            {it.category && <span className="outsource-detail-cat">· {it.category}</span>}
                          </div>
                        )}
                        <div className="outsource-detail-body">
                          <span className="outsource-detail-meta">
                            {qty > 0 ? `${qty}${unit}` : ''}
                            {it.unitPrice > 0 && qty > 0 ? ` · 단가 ${Number(it.unitPrice).toLocaleString()}원` : ''}
                          </span>
                          <strong className="outsource-detail-amount">{fmtMoney(it.amount)}</strong>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Modal>
        );
      })()}

      {/* 업체 상세 모달 */}
      <Modal isOpen={!!detailVendor} onClose={() => setDetailVendor(null)} title={detailVendor?.name || '업체 상세'}>
        {detailVendor && (
          <>
            <div className="tab-nav" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`tab-nav-item ${detailTab === 'freelancers' ? 'active' : ''}`}
                onClick={() => setDetailTab('freelancers')}
              >
                포함 직원 {detailVendor.freelancers.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{detailVendor.freelancers.length}</span>}
              </button>
              <button
                type="button"
                className={`tab-nav-item ${detailTab === 'projects' ? 'active' : ''}`}
                onClick={() => setDetailTab('projects')}
              >
                프로젝트 {(detailVendor.projects || []).length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{detailVendor.projects.length}</span>}
              </button>
            </div>

            {detailLoading ? (
              <div className="loading">로딩 중...</div>
            ) : detailTab === 'freelancers' ? (
              <>
                {detailVendor.freelancers.length === 0 ? (
                  <p className="empty-state">등록된 소속 직원이 없습니다.</p>
                ) : (
                  <ul className="vendor-detail-list">
                    {detailVendor.freelancers.map((f) => {
                      const isEditing = editRateFor === f.id;
                      const fmtYM = (s) => {
                        if (!s) return '';
                        const [yy, mm] = s.split('-');
                        return yy && mm ? `${yy}년 ${Number(mm)}월` : s;
                      };
                      const fromLabel = f.dailyRateFrom ? `${fmtYM(f.dailyRateFrom)}부터` : '';
                      // rateHistory(신규) + previousDailyRate*(레거시)를 모두 모아 내림차순 표시
                      const historyList = [];
                      if (Array.isArray(f.rateHistory)) {
                        f.rateHistory.forEach((h) => {
                          if (!h || !(Number(h.rate) > 0)) return;
                          historyList.push({
                            rate: Number(h.rate),
                            from: h.effectiveFrom || '',
                            to: h.effectiveTo || '',
                            isLegacy: false,
                          });
                        });
                      }
                      if (Number(f.previousDailyRate) > 0) {
                        const legacyFrom = f.previousDailyRateFrom || '';
                        const legacyTo = f.previousDailyRateTo || '';
                        const dup = historyList.some((h) => h.rate === Number(f.previousDailyRate) && h.from === legacyFrom && h.to === legacyTo);
                        if (!dup) historyList.push({ rate: Number(f.previousDailyRate), from: legacyFrom, to: legacyTo, isLegacy: true });
                      }
                      historyList.sort((a, b) => (b.from || '').localeCompare(a.from || ''));
                      return (
                        <li key={f.id} className="vendor-detail-item">
                          <div className="vendor-detail-row-main">
                            <strong>{f.name}</strong>
                            <span>
                              {f.dailyRate > 0 ? `${Number(f.dailyRate).toLocaleString()}원` : '단가 미입력'}
                              {fromLabel && ` · ${fromLabel}`}
                              {f.contact && ` · ${f.contact}`}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => (isEditing ? setEditRateFor(null) : openRateEdit(f))}
                            >
                              {isEditing ? '취소' : '단가 변경'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger-outline"
                              title="이 소속 직원 삭제"
                              onClick={async () => {
                                if (!confirm(`"${f.name}"을(를) 이 업체에서 완전히 삭제하시겠습니까?\n(외주관리에서도 제거되며, 공수표에 기록된 과거 내역은 남습니다.)`)) return;
                                setDetailBusy(true);
                                try {
                                  await deleteFreelancer(f.id);
                                  if (editRateFor === f.id) setEditRateFor(null);
                                  await reloadDetail();
                                } catch (err) {
                                  alert('삭제 실패: ' + err.message);
                                } finally {
                                  setDetailBusy(false);
                                }
                              }}
                              disabled={detailBusy}
                            >
                              삭제
                            </button>
                          </div>
                          {historyList.length > 0 && (() => {
                            const isOpen = !!openHistoryFor[f.id];
                            return (
                              <div className="rate-history-list">
                                <button
                                  type="button"
                                  className="rate-history-toggle"
                                  onClick={() => setOpenHistoryFor((s) => ({ ...s, [f.id]: !s[f.id] }))}
                                  aria-expanded={isOpen}
                                >
                                  <span className={`rate-history-caret${isOpen ? ' open' : ''}`}>▸</span>
                                  단가 이력 ({historyList.length})
                                </button>
                                {isOpen && historyList.map((h, idx) => {
                                  const hf = fmtYM(h.from);
                                  const ht = fmtYM(h.to);
                                  const period = hf || ht ? `(${hf || '이전'} ~ ${ht || '이전'})` : '';
                                  return (
                                    <div className="previous-rate-info" key={`${h.rate}-${h.from}-${h.to}-${idx}`}>
                                      <span>{h.rate.toLocaleString()}원 {period}</span>
                                      <button
                                        type="button"
                                        className="rate-history-delete"
                                        title="이 이력 삭제"
                                        aria-label="이 이력 삭제"
                                        onClick={async () => {
                                          if (!confirm(`${h.rate.toLocaleString()}원 ${period} 이력을 삭제하시겠습니까?`)) return;
                                          setDetailBusy(true);
                                          try {
                                            await removeRateHistoryByFields(f.id, {
                                              from: h.from, to: h.to, rate: h.rate, isLegacy: h.isLegacy,
                                            });
                                            await reloadDetail();
                                          } catch (err) {
                                            alert('삭제 실패: ' + err.message);
                                          } finally {
                                            setDetailBusy(false);
                                          }
                                        }}
                                        disabled={detailBusy}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          {isEditing && (
                            <div className="rate-edit-panel">
                              <div className="rate-edit-row">
                                <label>적용 월</label>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <select value={rateEdit.year} onChange={(e) => setRateEdit({ ...rateEdit, year: Number(e.target.value) })}>
                                    {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
                                  </select>
                                  <select value={rateEdit.month} onChange={(e) => setRateEdit({ ...rateEdit, month: Number(e.target.value) })}>
                                    {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => <option key={mm} value={mm}>{mm}월</option>)}
                                  </select>
                                </div>
                              </div>
                              <div className="rate-edit-row">
                                <label>새 단가</label>
                                <MoneyInput
                                  value={rateEdit.rate || 0}
                                  onChange={(e) => setRateEdit({ ...rateEdit, rate: e.target.value })}
                                />
                              </div>
                              <p className="rate-edit-hint">지정한 월부터 공수표에 자동 적용됩니다. 과거 공수표는 영향 없습니다.</p>
                              <div className="rate-edit-actions">
                                <button type="button" className="btn btn-sm btn-primary" disabled={detailBusy} onClick={() => handleSaveRate(f.id)}>
                                  {detailBusy ? '저장 중…' : '저장'}
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <form className="vendor-add-form" onSubmit={handleAddFreelancerToVendor}>
                  <input
                    ref={newFreelancerNameRef}
                    placeholder="직원 이름"
                    value={newFreelancer.name}
                    onChange={(e) => setNewFreelancer({ ...newFreelancer, name: e.target.value })}
                    lang="ko"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <MoneyInput
                    placeholder="일당"
                    value={newFreelancer.dailyRate || 0}
                    onChange={(e) => setNewFreelancer({ ...newFreelancer, dailyRate: e.target.value })}
                  />
                  <button type="submit" className="btn btn-sm btn-primary" disabled={detailBusy}>
                    {detailBusy ? '…' : '+ 추가'}
                  </button>
                </form>
              </>
            ) : (
              <>
                {(detailVendor.projects || []).length === 0 ? (
                  <p className="empty-state">등록된 프로젝트가 없습니다.</p>
                ) : (
                  <ul className="vendor-detail-list">
                    {detailVendor.projects.map((p) => (
                      <li key={p.name}>
                        <strong>{p.name}</strong>
                        <span>{p.unitPrice > 0 ? `건당 ${Number(p.unitPrice).toLocaleString()}원` : '단가 미입력'}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-outline"
                          onClick={() => handleRemoveProject(p)}
                          disabled={detailBusy}
                        >삭제</button>
                      </li>
                    ))}
                  </ul>
                )}
                <form className="vendor-add-form" onSubmit={handleAddProject}>
                  <input
                    placeholder="프로젝트명"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  />
                  <MoneyInput
                    placeholder="건당 단가"
                    value={newProject.unitPrice || 0}
                    onChange={(e) => setNewProject({ ...newProject, unitPrice: e.target.value })}
                  />
                  <button type="submit" className="btn btn-sm btn-primary" disabled={detailBusy}>
                    {detailBusy ? '…' : '+ 추가'}
                  </button>
                </form>
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
