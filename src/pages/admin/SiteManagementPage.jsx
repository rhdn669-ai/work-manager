import { useState, useEffect } from 'react';
import { getAllSites, createSite, updateSite, deleteSite } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import Modal from '../../components/common/Modal';

export default function SiteManagementPage() {
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editSite, setEditSite] = useState(null);
  const [form, setForm] = useState({
    name: '', team: '', managerIds: [],
  });
  const [vendorText, setVendorText] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [s, u] = await Promise.all([getAllSites(), getUsers()]);
      setSites(s);
      setUsers(u);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditSite(null);
    setForm({ name: '', team: '', managerIds: [] });
    setVendorText('');
    setShowModal(true);
  }

  function openEdit(site) {
    setEditSite(site);
    setForm({
      name: site.name,
      team: site.team || '',
      managerIds: site.managerIds || [],
    });
    setVendorText((site.defaultVendors || []).join(', '));
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const defaultVendors = vendorText
      .split(',').map((s) => s.trim()).filter(Boolean);
    try {
      if (editSite) {
        await updateSite(editSite.id, { ...form, defaultVendors });
      } else {
        await createSite({ ...form, defaultVendors });
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(site) {
    if (!confirm(`"${site.name}" 현장을 삭제하시겠습니까?\n(기존 마감 데이터는 남습니다)`)) return;
    try {
      await deleteSite(site.id);
      await loadData();
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  }

  function toggleManager(uid) {
    setForm((f) => ({
      ...f,
      managerIds: f.managerIds.includes(uid)
        ? f.managerIds.filter((x) => x !== uid)
        : [...f.managerIds, uid],
    }));
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const userMap = Object.fromEntries(users.map((u) => [u.uid, u]));
  // 관리자는 항상 모든 현장 접근 가능하므로 후보에서 제외
  const candidates = users.filter((u) => u.role !== 'admin');

  return (
    <div className="site-management-page">
      <div className="page-header">
        <h2>현장 관리</h2>
        <button className="btn btn-primary" onClick={openCreate}>현장 추가</button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>현장명</th>
            <th>팀</th>
            <th>담당자</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.team || '-'}</td>
              <td>
                {(s.managerIds || []).map((uid) => userMap[uid]?.name || uid).join(', ') || '-'}
              </td>
              <td>
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}>수정</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s)}>삭제</button>
              </td>
            </tr>
          ))}
          {sites.length === 0 && (
            <tr><td colSpan="4"><div className="text-muted text-center">등록된 현장이 없습니다.</div></td></tr>
          )}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editSite ? '현장 수정' : '현장 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>현장명 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="예: 메티스 프로버" />
          </div>
          <div className="form-group">
            <label>팀</label>
            <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="예: 전장 2팀" />
          </div>
          <div className="form-group">
            <label>담당자 선택</label>
            <p className="text-muted text-sm" style={{ marginTop: -4, marginBottom: 8 }}>
              관리자는 항상 모든 현장에 접근 가능합니다. 그 외 담당 사용자만 체크하세요.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 8,
                maxHeight: 300,
                overflowY: 'auto',
                padding: 12,
                borderRadius: 10,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
              }}
            >
              {candidates.length === 0 && (
                <p className="text-muted text-sm" style={{ gridColumn: '1 / -1', margin: 0, textAlign: 'center' }}>
                  선택 가능한 사용자가 없습니다.
                </p>
              )}
              {candidates.map((u) => {
                const checked = form.managerIds.includes(u.uid);
                return (
                  <label
                    key={u.uid}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: checked ? '#eff6ff' : '#ffffff',
                      border: `1.5px solid ${checked ? '#3b82f6' : '#e5e7eb'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      boxShadow: checked ? '0 0 0 3px rgba(59, 130, 246, 0.1)' : 'none',
                      userSelect: 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) e.currentTarget.style.borderColor = '#9ca3af';
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) e.currentTarget.style.borderColor = '#e5e7eb';
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleManager(u.uid)}
                      style={{ flexShrink: 0, width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: checked ? '#1e40af' : '#111827',
                          lineHeight: 1.3,
                        }}
                      >
                        {u.name}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: '#6b7280',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {u.code}{u.position && ` · ${u.position}`}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
            {form.managerIds.length > 0 && (
              <p className="text-sm" style={{ marginTop: 6, color: '#2563eb' }}>
                선택됨: <strong>{form.managerIds.length}명</strong>
              </p>
            )}
          </div>
          <div className="form-group">
            <label>기본 업체 목록 (쉼표 구분)</label>
            <textarea
              value={vendorText}
              onChange={(e) => setVendorText(e.target.value)}
              rows={2}
              placeholder="예: 아이오피엔, 우진테크, 태산전기조명, 엔비에이"
            />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editSite ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
