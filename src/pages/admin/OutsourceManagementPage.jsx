import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/useAuth';
import {
  getFreelancers,
  addFreelancer,
  updateFreelancer,
  getVendors,
  addVendor,
  updateVendor,
  getVendorDetail,
  addFreelancerToVendor,
  addVendorProject,
  removeVendorProject,
  setFreelancerRate,
  removeRateHistoryByFields,
  getAllClosingItems,
} from '../../services/outsourceService';
import { getAllSites } from '../../services/siteService';
import { trashGeneric, restoreTrashItem } from '../../services/trashService';
import { useUndo } from '../../contexts/useUndo';
import { ensureFolderPath, uploadFile } from '../../services/fileLibraryService';
import { extractBizInfo, normalizeCompany, isSupportedBizFile } from '../../utils/bizPdf';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';
import Select from '../../components/common/Select';
import TrashModal from '../../components/common/TrashModal';
import { useDialog } from '../../components/common/useDialog';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';

export default function OutsourceManagementPage() {
  const { isAdmin, canViewSalary, userProfile } = useAuth();
  const { confirm, alert, toast } = useDialog();
  const { push: pushUndo } = useUndo();
  const [tab, setTab] = useState('freelancer'); // 'freelancer' | 'daily' | 'vendor'
  const [trashOpen, setTrashOpen] = useState(false);
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
  const [pdfFiles, setPdfFiles] = useState([]); // 업체 PDF들 (사업자등록증·통장사본 등)
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pdfInputRef = useRef(null);
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
    if (!rateEdit.year || !rateEdit.month) {
      alert('적용 년/월을 선택해주세요.');
      return;
    }
    if (!rateEdit.rate || Number(rateEdit.rate) <= 0) {
      alert('단가를 입력해주세요.');
      return;
    }
    const effectiveFromMonth = `${rateEdit.year}-${String(rateEdit.month).padStart(2, '0')}-01`;
    setDetailBusy(true);
    try {
      await setFreelancerRate(freelancerId, {
        dailyRate: rateEdit.rate,
        effectiveFromMonth,
      });
      setEditRateFor(null);
      await reloadDetail();
    } catch {
      toast('단가 저장 중 오류가 발생했습니다', 'error');
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
      setDetailVendor((prev) =>
        prev ? { ...prev, freelancers: detail.freelancers, projects: detail.projects } : null,
      );
    } catch {
      toast('상세 조회 중 오류가 발생했습니다', 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  async function reloadDetail() {
    if (!detailVendor) return;
    const detail = await getVendorDetail(detailVendor.id, detailVendor.name);
    setDetailVendor((prev) => (prev ? { ...prev, freelancers: detail.freelancers, projects: detail.projects } : null));
    await loadAll();
  }

  async function handleAddFreelancerToVendor(e) {
    e.preventDefault();
    if (!newFreelancer.name?.trim()) {
      alert('이름을 입력해주세요.');
      return;
    }
    setDetailBusy(true);
    try {
      await addFreelancerToVendor(detailVendor.name, {
        name: newFreelancer.name.trim(),
        dailyRate: Number(newFreelancer.dailyRate) || 0,
      });
      setNewFreelancer({ name: '', dailyRate: detailVendor.dailyRate || 0 });
      await reloadDetail();
      // 다음 직원 이름을 바로 입력할 수 있도록 이름 input에 재포커스 → IME가 한글 모드로 복귀
      setTimeout(() => {
        newFreelancerNameRef.current?.focus();
      }, 0);
    } catch {
      toast('직원 추가 중 오류가 발생했습니다', 'error');
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleAddProject(e) {
    e.preventDefault();
    const name = newProject.name.trim();
    if (!name) {
      alert('프로젝트명을 입력해주세요.');
      return;
    }
    if ((detailVendor.projects || []).some((p) => p.name === name)) {
      alert('이미 등록된 프로젝트입니다.');
      return;
    }
    setDetailBusy(true);
    try {
      await addVendorProject(detailVendor.id, { name, unitPrice: newProject.unitPrice });
      setNewProject({ name: '', unitPrice: detailVendor.caseRate || 0 });
      await reloadDetail();
    } catch {
      toast('프로젝트 추가 중 오류가 발생했습니다', 'error');
    } finally {
      setDetailBusy(false);
    }
  }

  async function handleRemoveProject(project) {
    if (!(await confirm(`"${project.name}"을(를) 삭제하시겠습니까?`))) return;
    setDetailBusy(true);
    try {
      await removeVendorProject(detailVendor.id, project);
      await reloadDetail();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    } finally {
      setDetailBusy(false);
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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function shiftFilterMonth(delta) {
    let y = filterYear;
    let m = filterMonth + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setFilterYear(y);
    setFilterMonth(m);
  }

  function openCreate() {
    setEditItem(null);
    if (tab === 'vendor') {
      setForm({
        name: '',
        representative: '',
        contact: '',
        email: '',
        businessNumber: '',
        category: '',
        bankName: '',
        bankAccount: '',
        note: '',
      });
    } else {
      // freelancer / daily 공통 (workerType만 탭에 맞게 설정)
      setForm({ name: '', vendor: '', dailyRate: 0, contact: '', note: '', workerType: tab });
    }
    setPdfFiles([]);
    setPdfStatus('');
    setShowModal(true);
  }

  function openEdit(item) {
    setEditItem(item);
    setForm({ ...item });
    setPdfFiles([]);
    setPdfStatus('');
    setShowModal(true);
  }

  // 업체 PDF·이미지(여러 개 가능) → 텍스트/OCR 자동 입력 + 자료실 보관 (사업자등록증·통장사본 합산)
  async function handlePdfFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => isSupportedBizFile(f));
    if (files.length === 0) {
      alert('PDF 또는 이미지(JPG·PNG) 파일만 가능합니다.');
      return;
    }
    setPdfBusy(true);
    setPdfFiles((prev) => [...prev, ...files]);
    setPdfStatus('PDF 읽는 중…');
    try {
      const merged = { name: '', representative: '', businessNumber: '', bankName: '', bankAccount: '' };
      let usedOcr = false;
      for (let i = 0; i < files.length; i += 1) {
        const label = files.length > 1 ? `(${i + 1}/${files.length}) ` : '';
        const { parsed, usedOcr: o } = await extractBizInfo(files[i], (stage, progress) => {
          if (stage === 'reading') setPdfStatus(`${label}PDF 읽는 중…`);
          else if (stage === 'rendering') setPdfStatus(`${label}스캔 감지 — 이미지 변환 중…`);
          else if (stage === 'ocr') setPdfStatus(`${label}OCR 인식 중… ${Math.round((progress || 0) * 100)}%`);
        });
        usedOcr = usedOcr || o;
        Object.keys(merged).forEach((k) => {
          if (!merged[k] && parsed[k]) merged[k] = parsed[k];
        });
      }
      setForm((f) => ({
        ...f,
        name: merged.name || f.name,
        representative: merged.representative || f.representative,
        businessNumber: merged.businessNumber || f.businessNumber,
        bankName: merged.bankName || f.bankName,
        bankAccount: merged.bankAccount || f.bankAccount,
      }));
      const got = merged.name || merged.businessNumber || merged.bankName || merged.bankAccount;
      if (!got) {
        setPdfStatus('');
        alert(
          `정보를 충분히 읽지 못했습니다${usedOcr ? ' (OCR 시도함)' : ''}. 직접 확인·입력해 주세요. 파일은 자료실에 보관됩니다.`,
        );
      } else {
        setPdfStatus(usedOcr ? 'OCR로 자동 입력됨 (값 확인 권장)' : '자동 입력됨');
      }
    } catch {
      setPdfStatus('');
      toast('PDF 처리 중 오류가 발생했습니다', 'error');
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (submitting) return;
    if (!form.name?.trim()) {
      alert('이름을 입력해주세요.');
      return;
    }
    const isVendor = tab === 'vendor';
    const filesToUpload = isVendor ? pdfFiles : [];
    // 업체는 회사명 통일(주식회사 → (주)), 사람(프리랜서/일용직) 이름은 그대로
    const vendorName = isVendor ? normalizeCompany(form.name) || form.name.trim() : form.name.trim();
    setSubmitting(true);
    try {
      if (isVendor) {
        const data = { ...form, name: vendorName };
        if (editItem) await updateVendor(editItem.id, data);
        else await addVendor(data);
      } else {
        const payload = { ...form, workerType: form.workerType || tab };
        if (editItem) await updateFreelancer(editItem.id, payload);
        else await addFreelancer(payload);
      }
      // 저장 완료 → 모달 즉시 닫고 목록 갱신 (PDF 업로드를 기다리지 않음)
      setShowModal(false);
      setPdfFiles([]);
      await loadAll();
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    // 첨부 PDF들은 모달 닫은 뒤 백그라운드로 자료실 "거래처 정보/{업체명}" 폴더에 보관
    if (filesToUpload.length > 0) {
      try {
        const folderId = await ensureFolderPath(['거래처 정보', vendorName], userProfile);
        for (let i = 0; i < filesToUpload.length; i += 1) {
          await uploadFile(
            filesToUpload[i],
            folderId,
            userProfile,
            undefined,
            `${vendorName}_${filesToUpload[i].name}`,
          );
        }
      } catch {
        toast('PDF 자료실 보관 중 오류가 발생했습니다', 'error');
      }
    }
  }

  async function handleDelete(item) {
    const label = tab === 'vendor' ? '업체' : tab === 'daily' ? '일용직' : '프리랜서';
    if (!(await confirm(`"${item.name}" ${label}를 삭제하시겠습니까?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      const collectionName = tab === 'vendor' ? 'vendors' : 'freelancers';
      const summary =
        tab === 'vendor'
          ? [item.representative, item.businessNumber].filter(Boolean).join(' · ')
          : [label, item.contact].filter(Boolean).join(' · ');
      const tid = await trashGeneric(
        collectionName,
        item.id,
        {
          title: item.name,
          summary,
        },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      await loadAll();
      if (tid)
        pushUndo(`${label} "${item.name}" 삭제`, async () => {
          await restoreTrashItem(tid);
          await loadAll();
        });
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  if (!isAdmin)
    return (
      <div className="card">
        <div className="card-body empty-state">접근 권한이 없습니다.</div>
      </div>
    );

  // 업체 소속이 없는 개인 인력만 프리랜서/일용직 탭에 표시 (workerType 미지정은 freelancer로 간주)
  const soloFreelancers = freelancers.filter(
    (f) => !(f.vendor || '').trim() && (f.workerType || 'freelancer') === 'freelancer',
  );
  const soloDailies = freelancers.filter((f) => !(f.vendor || '').trim() && f.workerType === 'daily');

  // 업체 표용 — 소속 직원 수 / 등록 프로젝트 수 (로드된 데이터로 계산, 추가 조회 없음)
  const vendorEmpCount = (v) => freelancers.filter((f) => (f.vendor || '').trim() === (v.name || '').trim()).length;
  const vendorProjCount = (v) => {
    const names = new Set();
    (Array.isArray(v.projects) ? v.projects : []).forEach((p) => names.add(typeof p === 'string' ? p : p?.name));
    (Array.isArray(v.projectNames) ? v.projectNames : []).forEach((n) => names.add(n));
    names.delete(undefined);
    names.delete('');
    return names.size;
  };

  // 선택된 기간 필터 — 월별 / 전체
  const filteredItems =
    filterMode === 'month'
      ? closingItems.filter((it) => Number(it.year) === filterYear && Number(it.month) === filterMonth)
      : closingItems;

  // 탭별 지출 합계 (선택된 기간 기준)
  const sumByItemTypes = (types, list = filteredItems) =>
    list.filter((it) => types.includes(it.itemType)).reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const freelancerSpend = sumByItemTypes(['freelancer']);
  const dailySpend = sumByItemTypes(['daily']);
  const vendorSpend = sumByItemTypes(['vendor', 'vendor_case']);

  const fmtMoney = (n) => `${Number(n || 0).toLocaleString()}원`;
  const currentSpend = tab === 'freelancer' ? freelancerSpend : tab === 'daily' ? dailySpend : vendorSpend;
  const currentTabTypes =
    tab === 'freelancer' ? ['freelancer'] : tab === 'daily' ? ['daily'] : ['vendor', 'vendor_case'];
  const currentTabLabel = tab === 'freelancer' ? '프리랜서' : tab === 'daily' ? '일용직' : '업체';
  const periodLabel = filterMode === 'month' ? `${filterYear}년 ${filterMonth}월` : '전체 기간';
  const siteNameMap = Object.fromEntries(sites.map((s) => [s.id, s.name]));

  // 현재 탭 기간별 공수표 항목 집합 (인원/업체별 집계용)
  const currentTabItems = filteredItems.filter((it) => currentTabTypes.includes(it.itemType));

  // 인원/업체별 집계 — key = 이름(freelancer/daily) 또는 업체명(vendor)
  const groupKey = (it) => (tab === 'vendor' ? it.vendor || '(미지정)' : it.detail || '(이름없음)');
  const perPerson = Object.values(
    currentTabItems
      .filter((it) => Number(it.amount) > 0) // 금액 0은 집계 모달에서 제외
      .reduce((acc, it) => {
        const k = groupKey(it);
        if (!acc[k]) acc[k] = { key: k, total: 0, count: 0 };
        acc[k].total += Number(it.amount) || 0;
        acc[k].count += 1;
        return acc;
      }, {}),
  ).sort((a, b) => b.total - a.total);

  return (
    <div className="outsource-management-page">
      <div className="page-header">
        <h2>외주 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="plus" className="btn-ic" />
            {tab === 'vendor' ? '업체' : tab === 'daily' ? '일용직' : '프리랜서'} 추가
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['vendors', 'freelancers']}
        title="외주 휴지통"
        onChange={loadAll}
      />

      <div className="tab-nav" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'freelancer' ? 'active' : ''}`}
          onClick={() => setTab('freelancer')}
        >
          프리랜서{' '}
          {soloFreelancers.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{soloFreelancers.length}</span>}
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
              >
                월별
              </button>
              <button
                type="button"
                className={`outsource-filter-btn ${filterMode === 'all' ? 'active' : ''}`}
                onClick={() => setFilterMode('all')}
              >
                전체
              </button>
            </div>
            {filterMode === 'month' && (
              <div className="outsource-spend-month-nav">
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-icon"
                  onClick={() => shiftFilterMonth(-1)}
                  aria-label="이전 달"
                  title="이전 달"
                >
                  <Icon name="chevronRight" className="btn-ic" style={{ transform: 'rotate(180deg)' }} />
                </button>
                <span className="outsource-spend-ym">
                  {filterYear}년 {filterMonth}월
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-icon"
                  onClick={() => shiftFilterMonth(1)}
                  aria-label="다음 달"
                  title="다음 달"
                >
                  <Icon name="chevronRight" className="btn-ic" />
                </button>
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
            <span className="outsource-spend-summary-label">
              {currentTabLabel} 지출 · {periodLabel}
            </span>
            <strong className="outsource-spend-summary-amount" style={{ color: 'var(--primary)' }}>
              {fmtMoney(currentSpend)}
            </strong>
            {perPerson.length > 0 && (
              <span
                className="outsource-spend-summary-sub"
                title={`${perPerson.length}명 · 클릭하여 인원별 보기`}
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block',
                  maxWidth: '100%',
                }}
              >
                {perPerson.length}명 · 클릭하여 인원별 보기 →
              </span>
            )}
          </button>
        </div>
      )}

      {loading ? (
        <Skeleton.Rows count={6} />
      ) : tab === 'freelancer' || tab === 'daily' ? (
        (tab === 'freelancer' ? soloFreelancers : soloDailies).length === 0 ? (
          <div className="card">
            <div className="card-body empty-state">
              {tab === 'freelancer'
                ? '등록된 개인 프리랜서가 없습니다. (업체 소속 직원은 업체 상세에서 관리)'
                : '등록된 일용직이 없습니다.'}
            </div>
          </div>
        ) : (
          <div className="table-scroll-x">
            <table className="table table-clickable cards-sm">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>{tab === 'daily' ? '시급' : '일당'}</th>
                  <th>연락처</th>
                  <th>비고</th>
                  <th className="bom-project-action-col">작업</th>
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
                    <td data-label="이름" title={f.name || ''}>
                      <strong>{f.name}</strong>
                    </td>
                    <td data-label={tab === 'daily' ? '시급' : '일당'}>
                      {f.dailyRate ? `${Number(f.dailyRate).toLocaleString()}원` : '-'}
                    </td>
                    <td data-label="연락처" className="u-ellipsis" title={f.contact || ''}>
                      {f.contact || '-'}
                    </td>
                    <td data-label="비고" className="supplier-note-cell" title={f.note || ''}>
                      <span className="cell-clamp-2">{f.note || '-'}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()} className="bom-project-action-col">
                      <div className="btn-group" style={{ alignItems: 'stretch' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => openEdit(f)}
                          title="수정"
                          aria-label="수정"
                          style={{ minHeight: 36 }}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(f)}
                          title="삭제"
                          aria-label="삭제"
                          style={{ minHeight: 36 }}
                        >
                          <Icon name="trash" className="btn-ic" />
                          삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : vendors.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">등록된 업체가 없습니다.</div>
        </div>
      ) : (
        <div className="table-scroll-x">
          <table className="table cards-sm vendor-table">
            <thead>
              <tr>
                <th>상호</th>
                <th>대표</th>
                <th>연락처</th>
                <th>이메일</th>
                <th>사업자번호</th>
                <th>은행</th>
                <th>계좌번호</th>
                <th className="hide-mobile">분류</th>
                <th>직원수</th>
                <th>프로젝트수</th>
                <th className="hide-mobile">비고</th>
                <th className="bom-project-action-col">작업</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr
                  key={v.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openVendorDetail(v)}
                  title={`${v.name} 소속·프로젝트 보기`}
                >
                  <td data-label="상호" title={v.name || ''}>
                    <strong>{v.name}</strong>
                  </td>
                  <td data-label="대표" className="u-ellipsis" title={v.representative || ''}>
                    {v.representative || '-'}
                  </td>
                  <td data-label="연락처" className="u-ellipsis" title={v.contact || ''}>
                    {v.contact || '-'}
                  </td>
                  <td data-label="이메일" className="u-ellipsis" title={v.email || ''}>
                    {v.email || '-'}
                  </td>
                  <td data-label="사업자번호" className="u-ellipsis" title={v.businessNumber || ''}>
                    {v.businessNumber || '-'}
                  </td>
                  <td data-label="은행" className="u-ellipsis" title={v.bankName || ''}>
                    {v.bankName || '-'}
                  </td>
                  <td data-label="계좌번호" className="u-wrap" title={v.bankAccount || ''}>
                    {v.bankAccount || '-'}
                  </td>
                  <td data-label="분류" className="u-ellipsis hide-mobile" title={v.category || ''}>
                    {v.category || '-'}
                  </td>
                  <td data-label="직원수">{vendorEmpCount(v)}명</td>
                  <td data-label="프로젝트수">{vendorProjCount(v)}개</td>
                  <td data-label="비고" className="supplier-note-cell hide-mobile" title={v.note || ''}>
                    <span className="cell-clamp-2">{v.note || '-'}</span>
                  </td>
                  <td className="bom-project-action-col" onClick={(e) => e.stopPropagation()}>
                    <div className="btn-group" style={{ alignItems: 'stretch' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => openEdit(v)}
                        title="수정"
                        aria-label="수정"
                        style={{ minHeight: 36 }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(v)}
                        title="삭제"
                        aria-label="삭제"
                        style={{ minHeight: 36 }}
                      >
                        <Icon name="trash" className="btn-ic" />
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={`${tab === 'vendor' ? '업체' : tab === 'daily' ? '일용직' : '프리랜서'} ${editItem ? '수정' : '추가'}`}
      >
        <form onSubmit={handleSave}>
          {tab === 'vendor' && (
            <div className="form-group">
              <label>PDF 첨부 (사업자등록증·통장사본)</label>
              <div
                className={`pdf-dropzone ${pdfDragOver ? 'is-over' : ''} ${pdfBusy ? 'is-busy' : ''}`}
                onClick={() => !pdfBusy && pdfInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!pdfBusy) setPdfDragOver(true);
                }}
                onDragLeave={() => setPdfDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setPdfDragOver(false);
                  if (e.dataTransfer.files?.length) handlePdfFiles(e.dataTransfer.files);
                }}
              >
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf,image/*"
                  multiple
                  style={{ display: 'none' }}
                  disabled={pdfBusy}
                  onChange={(e) => {
                    const fl = e.target.files;
                    e.target.value = '';
                    if (fl?.length) handlePdfFiles(fl);
                  }}
                />
                <Icon name="doc" className="pdf-dropzone-icon" />
                <span>
                  {pdfFiles.length
                    ? `${pdfFiles.length}개 첨부됨 (클릭/드롭으로 더 추가)`
                    : 'PDF를 끌어다 놓거나 클릭해서 선택 (여러 개 가능)'}
                </span>
              </div>
              {(pdfBusy || pdfFiles.length > 0) && (
                <p className="field-hint">
                  {pdfBusy
                    ? pdfStatus || 'PDF 처리 중…'
                    : `${pdfStatus ? pdfStatus + ' · ' : ''}${pdfFiles.map((f) => f.name).join(', ')} — 저장 시 자료실 "거래처 정보/${normalizeCompany(form.name) || (form.name || '').trim() || '업체명'}" 폴더에 보관됩니다.`}
                </p>
              )}
            </div>
          )}
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
                <label>대표자</label>
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
                <label>이메일</label>
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="예: sales@company.com"
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
              <div className="form-group">
                <label>분류</label>
                <input
                  value={form.category || ''}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="예: 자재, 공구, 소모품"
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label>은행</label>
                <input
                  value={form.bankName || ''}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  placeholder="예: 국민은행"
                  lang="ko"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="form-group">
                <label>계좌번호</label>
                <input
                  value={form.bankAccount || ''}
                  onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
                  placeholder="계좌번호 · 예금주"
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label>메모</label>
                <textarea
                  rows={2}
                  value={form.note || ''}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
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
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowModal(false)}
              disabled={submitting}
              style={{ minHeight: 36 }}
            >
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ minHeight: 36 }}>
              {submitting ? '저장 중…' : editItem ? '수정' : '추가'}
            </button>
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
      {detailFor &&
        (() => {
          const types = detailFor.kind === 'vendor' ? ['vendor', 'vendor_case'] : [detailFor.kind];
          const matcher = (it) =>
            types.includes(it.itemType) &&
            (detailFor.kind === 'vendor' ? (it.vendor || '') === detailFor.name : (it.detail || '') === detailFor.name);
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
                        ? it.detail || (it.itemType === 'vendor_case' ? '프로젝트 미지정' : '직원 미지정')
                        : it.vendor || '';
                      const itemKind = isVendorTab
                        ? it.itemType === 'vendor_case'
                          ? '프로젝트'
                          : '직원'
                        : it.vendor
                          ? '소속 업체'
                          : '';
                      return (
                        <li key={it.id}>
                          <div className="outsource-detail-head">
                            <strong>
                              {it.year}년 {it.month}월
                            </strong>
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
            <div className="tab-nav" style={{ marginBottom: 8 }}>
              <button
                type="button"
                className={`tab-nav-item ${detailTab === 'freelancers' ? 'active' : ''}`}
                onClick={() => setDetailTab('freelancers')}
              >
                포함 직원{' '}
                {detailVendor.freelancers.length > 0 && (
                  <span style={{ opacity: 0.6, marginLeft: 3 }}>{detailVendor.freelancers.length}</span>
                )}
              </button>
              <button
                type="button"
                className={`tab-nav-item ${detailTab === 'projects' ? 'active' : ''}`}
                onClick={() => setDetailTab('projects')}
              >
                프로젝트{' '}
                {(detailVendor.projects || []).length > 0 && (
                  <span style={{ opacity: 0.6, marginLeft: 3 }}>{detailVendor.projects.length}</span>
                )}
              </button>
            </div>

            {detailLoading ? (
              <Skeleton.Rows count={6} />
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
                        const dup = historyList.some(
                          (h) => h.rate === Number(f.previousDailyRate) && h.from === legacyFrom && h.to === legacyTo,
                        );
                        if (!dup)
                          historyList.push({
                            rate: Number(f.previousDailyRate),
                            from: legacyFrom,
                            to: legacyTo,
                            isLegacy: true,
                          });
                      }
                      historyList.sort((a, b) => (b.from || '').localeCompare(a.from || ''));
                      return (
                        <li key={f.id} className="vendor-detail-item">
                          <div
                            className="vendor-detail-row-main"
                            style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, flexWrap: 'wrap' }}
                          >
                            <strong className="u-ellipsis-1" title={f.name} style={{ minWidth: 0 }}>
                              {f.name}
                            </strong>
                            <span
                              title={`${f.dailyRate > 0 ? `${Number(f.dailyRate).toLocaleString()}원` : '단가 미입력'}${fromLabel ? ` · ${fromLabel}` : ''}${f.contact ? ` · ${f.contact}` : ''}`}
                            >
                              {f.dailyRate > 0 ? `${Number(f.dailyRate).toLocaleString()}원` : '단가 미입력'}
                              {fromLabel && ` · ${fromLabel}`}
                              {f.contact && ` · ${f.contact}`}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => (isEditing ? setEditRateFor(null) : openRateEdit(f))}
                              style={{ minHeight: 36 }}
                            >
                              {isEditing ? '취소' : '단가 변경'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              title="이 소속 직원 삭제"
                              aria-label="삭제"
                              style={{ minHeight: 36 }}
                              onClick={async () => {
                                if (
                                  !(await confirm(
                                    `"${f.name}"을(를) 이 업체에서 완전히 삭제하시겠습니까?\n(외주관리에서도 제거되며, 공수표에 기록된 과거 내역은 남습니다.)`,
                                  ))
                                )
                                  return;
                                setDetailBusy(true);
                                try {
                                  await trashGeneric(
                                    'freelancers',
                                    f.id,
                                    { title: f.name || '프리랜서' },
                                    userProfile?.name || '',
                                  );
                                  if (editRateFor === f.id) setEditRateFor(null);
                                  await reloadDetail();
                                } catch {
                                  toast('삭제 중 오류가 발생했습니다', 'error');
                                } finally {
                                  setDetailBusy(false);
                                }
                              }}
                              disabled={detailBusy}
                            >
                              <Icon name="trash" className="btn-ic" />
                              삭제
                            </button>
                          </div>
                          {historyList.length > 0 &&
                            (() => {
                              const isOpen = !!openHistoryFor[f.id];
                              return (
                                <div className="rate-history-list">
                                  <button
                                    type="button"
                                    className="rate-history-toggle"
                                    onClick={() => setOpenHistoryFor((s) => ({ ...s, [f.id]: !s[f.id] }))}
                                    aria-expanded={isOpen}
                                    title={`단가 이력 (${historyList.length}건)`}
                                    style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                  >
                                    <Icon
                                      name="chevronRight"
                                      className={`rate-history-caret${isOpen ? ' open' : ''}`}
                                    />
                                    단가 이력 ({historyList.length})
                                  </button>
                                  {isOpen &&
                                    historyList.map((h, idx) => {
                                      const hf = fmtYM(h.from);
                                      const ht = fmtYM(h.to);
                                      const period = hf || ht ? `(${hf || '이전'} ~ ${ht || '이전'})` : '';
                                      return (
                                        <div className="previous-rate-info" key={`${h.rate}-${h.from}-${h.to}-${idx}`}>
                                          <span title={`${h.rate.toLocaleString()}원 ${period}`}>
                                            {h.rate.toLocaleString()}원 {period}
                                          </span>
                                          <button
                                            type="button"
                                            className="btn btn-sm btn-danger"
                                            title="이 이력 삭제"
                                            aria-label="이 이력 삭제"
                                            onClick={async () => {
                                              if (
                                                !(await confirm(
                                                  `${h.rate.toLocaleString()}원 ${period} 이력을 삭제하시겠습니까?`,
                                                ))
                                              )
                                                return;
                                              setDetailBusy(true);
                                              try {
                                                await removeRateHistoryByFields(f.id, {
                                                  from: h.from,
                                                  to: h.to,
                                                  rate: h.rate,
                                                  isLegacy: h.isLegacy,
                                                });
                                                await reloadDetail();
                                              } catch {
                                                toast('삭제 중 오류가 발생했습니다', 'error');
                                              } finally {
                                                setDetailBusy(false);
                                              }
                                            }}
                                            disabled={detailBusy}
                                          >
                                            <Icon name="trash" className="btn-ic" />
                                            삭제
                                          </button>
                                        </div>
                                      );
                                    })}
                                </div>
                              );
                            })()}
                          {isEditing && (
                            <div className="rate-edit-panel">
                              <div className="rate-edit-row" style={{ flexDirection: 'column', gap: 4 }}>
                                <label style={{ minWidth: 56, flexShrink: 0 }}>적용 월</label>
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  <Select
                                    value={rateEdit.year}
                                    onChange={(v) => setRateEdit({ ...rateEdit, year: Number(v) })}
                                    ariaLabel="적용 년도"
                                    options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: `${y}년` }))}
                                  />
                                  <Select
                                    value={rateEdit.month}
                                    onChange={(v) => setRateEdit({ ...rateEdit, month: Number(v) })}
                                    ariaLabel="적용 월"
                                    options={Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => ({
                                      value: mm,
                                      label: `${mm}월`,
                                    }))}
                                  />
                                </div>
                              </div>
                              <div className="rate-edit-row" style={{ flexDirection: 'column', gap: 4 }}>
                                <label style={{ minWidth: 56, flexShrink: 0 }}>새 단가</label>
                                <MoneyInput
                                  value={rateEdit.rate || 0}
                                  onChange={(e) => setRateEdit({ ...rateEdit, rate: e.target.value })}
                                />
                              </div>
                              <p className="rate-edit-hint">
                                지정한 월부터 공수표에 자동 적용됩니다. 과거 공수표는 영향 없습니다.
                              </p>
                              <div className="rate-edit-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  disabled={detailBusy}
                                  onClick={() => handleSaveRate(f.id)}
                                  style={{ minHeight: 36 }}
                                >
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
                <form className="vendor-add-form" onSubmit={handleAddFreelancerToVendor} style={{ flexWrap: 'wrap' }}>
                  <input
                    ref={newFreelancerNameRef}
                    placeholder="직원 이름"
                    value={newFreelancer.name}
                    onChange={(e) => setNewFreelancer({ ...newFreelancer, name: e.target.value })}
                    lang="ko"
                    autoComplete="off"
                    spellCheck={false}
                    style={{ minWidth: 0, flex: '1 1 120px' }}
                  />
                  <MoneyInput
                    placeholder="일당"
                    value={newFreelancer.dailyRate || 0}
                    onChange={(e) => setNewFreelancer({ ...newFreelancer, dailyRate: e.target.value })}
                    style={{ minWidth: 0, flex: '1 1 100px' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={detailBusy}
                    style={{ flexShrink: 0, minHeight: 36 }}
                  >
                    {detailBusy ? '…' : '추가'}
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
                        <strong className="u-ellipsis" title={p.name}>
                          {p.name}
                        </strong>
                        <span>
                          {p.unitPrice > 0 ? `건당 ${Number(p.unitPrice).toLocaleString()}원` : '단가 미입력'}
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleRemoveProject(p)}
                          disabled={detailBusy}
                          style={{ minHeight: 36 }}
                        >
                          <Icon name="trash" className="btn-ic" />
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form className="vendor-add-form" onSubmit={handleAddProject} style={{ flexWrap: 'wrap' }}>
                  <input
                    placeholder="프로젝트명"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    style={{ minWidth: 0, flex: '1 1 120px' }}
                  />
                  <MoneyInput
                    placeholder="건당 단가"
                    value={newProject.unitPrice || 0}
                    onChange={(e) => setNewProject({ ...newProject, unitPrice: e.target.value })}
                    style={{ minWidth: 0, flex: '1 1 100px' }}
                  />
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={detailBusy}
                    style={{ flexShrink: 0, minHeight: 36 }}
                  >
                    {detailBusy ? '…' : '추가'}
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
