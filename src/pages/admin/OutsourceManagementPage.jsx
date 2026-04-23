import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getFreelancers, addFreelancer, updateFreelancer, deleteFreelancer,
  getVendors, addVendor, updateVendor, deleteVendor,
  importFromSiteClosings, getVendorDetail,
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

  async function openVendorDetail(v) {
    setDetailVendor({ ...v, freelancers: [], projects: [] });
    setDetailTab('freelancers');
    setDetailLoading(true);
    try {
      const { freelancers: fl, projects } = await getVendorDetail(v.name);
      setDetailVendor((prev) => prev ? { ...prev, freelancers: fl, projects } : null);
    } catch (err) {
      alert('상세 조회 실패: ' + err.message);
    } finally {
      setDetailLoading(false);
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
      : { name: '', representative: '', contact: '', note: '', dailyRate: 0, caseRate: 0 });
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

      <div className="tab-nav" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tab-nav-item ${tab === 'freelancer' ? 'active' : ''}`}
          onClick={() => setTab('freelancer')}
        >
          프리랜서 {freelancers.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{freelancers.length}</span>}
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
        freelancers.length === 0 ? (
          <div className="card"><div className="card-body empty-state">등록된 프리랜서가 없습니다.</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>이름</th>
                <th>소속 업체</th>
                <th>일당</th>
                <th>연락처</th>
                <th>비고</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {freelancers.map((f) => (
                <tr key={f.id}>
                  <td><strong>{f.name}</strong></td>
                  <td>{f.vendor || '-'}</td>
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
                <th>공수 단가</th>
                <th>건당 단가</th>
                <th>연락처</th>
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
                  <td>{v.dailyRate > 0 ? `${Number(v.dailyRate).toLocaleString()}원` : '-'}</td>
                  <td>{v.caseRate > 0 ? `${Number(v.caseRate).toLocaleString()}원` : '-'}</td>
                  <td>{v.contact || '-'}</td>
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
                <label>소속 업체</label>
                <input
                  value={form.vendor || ''}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  placeholder="선택 사항"
                />
              </div>
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
                <label>대표자</label>
                <input
                  value={form.representative || ''}
                  onChange={(e) => setForm({ ...form, representative: e.target.value })}
                  placeholder="선택 사항"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>공수(일) 단가</label>
                  <MoneyInput
                    value={form.dailyRate || 0}
                    onChange={(e) => setForm({ ...form, dailyRate: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>건당 단가</label>
                  <MoneyInput
                    value={form.caseRate || 0}
                    onChange={(e) => setForm({ ...form, caseRate: e.target.value })}
                  />
                </div>
              </div>
            </>
          )}
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
                참여 프로젝트 {detailVendor.projects.length > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{detailVendor.projects.length}</span>}
              </button>
            </div>

            {detailLoading ? (
              <div className="loading">로딩 중...</div>
            ) : detailTab === 'freelancers' ? (
              detailVendor.freelancers.length === 0 ? (
                <p className="empty-state">등록된 소속 직원이 없습니다.</p>
              ) : (
                <ul className="vendor-detail-list">
                  {detailVendor.freelancers.map((f) => (
                    <li key={f.id}>
                      <strong>{f.name}</strong>
                      <span>
                        {f.dailyRate > 0 && `${Number(f.dailyRate).toLocaleString()}원`}
                        {f.contact && ` · ${f.contact}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              detailVendor.projects.length === 0 ? (
                <p className="empty-state">참여 프로젝트 이력이 없습니다.</p>
              ) : (
                <ul className="vendor-detail-list">
                  {detailVendor.projects.map((p) => (
                    <li key={p.id}>
                      <strong>{p.name}</strong>
                      <span>
                        {p.months.join(', ')} · {p.entryCount}건
                        {p.totalAmount > 0 && ` · ${p.totalAmount.toLocaleString()}원`}
                      </span>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
