import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getFreelancers, addFreelancer, updateFreelancer, deleteFreelancer,
  getVendors, addVendor, updateVendor, deleteVendor,
  importFromSiteClosings, getVendorDetail,
  addFreelancerToVendor,
  addVendorProject, removeVendorProject,
  setFreelancerRate,
} from '../../services/outsourceService';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';

export default function OutsourceManagementPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('freelancer');
  const [freelancers, setFreelancers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [importing, setImporting] = useState(false);
  const [detailVendor, setDetailVendor] = useState(null);
  const [detailTab, setDetailTab] = useState('freelancers');
  const [detailLoading, setDetailLoading] = useState(false);
  const [newFreelancer, setNewFreelancer] = useState({ name: '', dailyRate: 0 });
  const [newProject, setNewProject] = useState({ name: '', unitPrice: 0 });
  const [detailBusy, setDetailBusy] = useState(false);
  const [editRateFor, setEditRateFor] = useState(null); // freelancer id
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

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin]);

  async function loadAll() {
    setLoading(true);
    try {
      const [fs, vs] = await Promise.all([getFreelancers(), getVendors()]);
      setFreelancers(fs);
      setVendors(vs);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  function openCreate() {
    setEditItem(null);
    setForm(tab === 'freelancer'
      ? { name: '', vendor: '', dailyRate: 0, contact: '', note: '' }
      : { name: '', representative: '', contact: '', businessNumber: '', bankAccount: '' });
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
      if (tab === 'freelancer') {
        if (editItem) await updateFreelancer(editItem.id, form);
        else await addFreelancer(form);
      } else {
        if (editItem) await updateVendor(editItem.id, form);
        else await addVendor(form);
      }
      setShowModal(false);
      await loadAll();
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  }

  async function handleDelete(item) {
    const label = tab === 'freelancer' ? '프리랜서' : '업체';
    if (!confirm(`"${item.name}" ${label}를 삭제하시겠습니까?`)) return;
    try {
      if (tab === 'freelancer') await deleteFreelancer(item.id);
      else await deleteVendor(item.id);
      await loadAll();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

  if (!isAdmin) return <div className="card"><div className="card-body empty-state">접근 권한이 없습니다.</div></div>;

  // 업체 소속이 없는 '개인 프리랜서'만 프리랜서 탭에 표시
  const soloFreelancers = freelancers.filter((f) => !(f.vendor || '').trim());

  return (
    <div className="outsource-management-page">
      <div className="page-header">
        <h2>외주 관리</h2>
        <div className="page-actions">
          <button
            className="btn btn-sm btn-outline"
            onClick={handleImport}
            disabled={importing}
            title="모든 프로젝트 공수표에서 프리랜서·업체 정보 일괄 가져오기"
          >
            {importing ? '가져오는 중...' : '공수표에서 가져오기'}
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            {tab === 'freelancer' ? '+ 프리랜서' : '+ 업체'} 추가
          </button>
        </div>
      </div>

      {(() => { return null; })()}
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
          className={`tab-nav-item ${tab === 'vendor' ? 'active' : ''}`}
          onClick={() => setTab('vendor')}
        >
          업체 {vendors.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{vendors.length}</span>}
        </button>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : tab === 'freelancer' ? (
        soloFreelancers.length === 0 ? (
          <div className="card"><div className="card-body empty-state">등록된 개인 프리랜서가 없습니다. (업체 소속 직원은 업체 상세에서 관리)</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>이름</th>
                <th>일당</th>
                <th>연락처</th>
                <th>비고</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {soloFreelancers.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.name}</strong></td>
                  <td>{f.dailyRate ? `${Number(f.dailyRate).toLocaleString()}원` : '-'}</td>
                  <td>{f.contact || '-'}</td>
                  <td style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.note || '-'}</td>
                  <td>
                    <div className="btn-group">
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(f)}>수정</button>
                      <button className="btn btn-sm btn-danger-outline" onClick={() => handleDelete(f)}>삭제</button>
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
          <table className="table">
            <thead>
              <tr>
                <th>업체명</th>
                <th>대표자</th>
                <th>연락처</th>
                <th>사업자번호</th>
                <th>계좌</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td>
                    <button className="vendor-name-link" onClick={() => openVendorDetail(v)} title="소속 직원·참여 프로젝트 보기">
                      <strong>{v.name}</strong>
                    </button>
                  </td>
                  <td>{v.representative || '-'}</td>
                  <td>{v.contact || '-'}</td>
                  <td>{v.businessNumber || '-'}</td>
                  <td style={{ maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.bankAccount || '-'}</td>
                  <td>
                    <div className="btn-group">
                      <button className="btn btn-sm btn-outline" onClick={() => openVendorDetail(v)}>상세</button>
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(v)}>수정</button>
                      <button className="btn btn-sm btn-danger-outline" onClick={() => handleDelete(v)}>삭제</button>
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
        title={`${tab === 'freelancer' ? '프리랜서' : '업체'} ${editItem ? '수정' : '추가'}`}
      >
        <form onSubmit={handleSave}>
          <div className="form-group">
            <label>이름 *</label>
            <input
              value={form.name || ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder={tab === 'freelancer' ? '홍길동' : '○○ 산업'}
            />
          </div>
          {tab === 'freelancer' ? (
            <>
              <div className="form-group">
                <label>일당</label>
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
                />
              </div>
              <div className="form-group">
                <label>연락처</label>
                <input
                  value={form.contact || ''}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                  placeholder="010-0000-0000"
                />
              </div>
              <div className="form-group">
                <label>사업자번호</label>
                <input
                  value={form.businessNumber || ''}
                  onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
                  placeholder="000-00-00000"
                />
              </div>
              <div className="form-group">
                <label>계좌</label>
                <input
                  value={form.bankAccount || ''}
                  onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
                  placeholder="은행명 · 계좌번호 · 예금주"
                />
              </div>
            </>
          )}
          {tab === 'freelancer' && (
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
                          });
                        });
                      }
                      if (Number(f.previousDailyRate) > 0) {
                        const legacyFrom = f.previousDailyRateFrom || '';
                        const legacyTo = f.previousDailyRateTo || '';
                        const dup = historyList.some((h) => h.rate === Number(f.previousDailyRate) && h.from === legacyFrom && h.to === legacyTo);
                        if (!dup) historyList.push({ rate: Number(f.previousDailyRate), from: legacyFrom, to: legacyTo });
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
                          </div>
                          {historyList.length > 0 && (
                            <div className="rate-history-list">
                              <div className="rate-history-title">단가 이력</div>
                              {historyList.map((h, idx) => {
                                const hf = fmtYM(h.from);
                                const ht = fmtYM(h.to);
                                const period = hf || ht ? `(${hf || '이전'} ~ ${ht || '이전'})` : '';
                                return (
                                  <div className="previous-rate-info" key={`${h.rate}-${h.from}-${h.to}-${idx}`}>
                                    {h.rate.toLocaleString()}원 {period}
                                  </div>
                                );
                              })}
                            </div>
                          )}
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
                    placeholder="직원 이름"
                    value={newFreelancer.name}
                    onChange={(e) => setNewFreelancer({ ...newFreelancer, name: e.target.value })}
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
