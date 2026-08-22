import { useState, useEffect } from 'react';
import { getAllSites, createSite, updateSite } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { trashGeneric } from '../../services/trashService';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';
import { isRealStaff } from '../../utils/workspace';

export default function SiteManagementPage() {
  const { confirm, toast } = useDialog();
  const { userProfile } = useAuth();
  const [sites, setSites] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editSite, setEditSite] = useState(null);
  const [form, setForm] = useState({
    name: '',
    team: '',
    managerIds: [],
  });
  const [vendorText, setVendorText] = useState('');
  const [managerListOpen, setManagerListOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

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
    setManagerListOpen(false);
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
    setManagerListOpen(false);
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const defaultVendors = vendorText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (editSite) {
        await updateSite(editSite.id, { ...form, defaultVendors });
      } else {
        await createSite({ ...form, defaultVendors });
      }
      setShowModal(false);
      await loadData();
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleDelete(site) {
    if (!(await confirm(`"${site.name}" 프로젝트를 삭제하시겠습니까?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      await trashGeneric('sites', site.id, { title: site.name, summary: '' }, userProfile?.name || '');
      toast('휴지통으로 이동했습니다.');
      await loadData();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  function toggleManager(uid) {
    setForm((f) => ({
      ...f,
      managerIds: f.managerIds.includes(uid) ? f.managerIds.filter((x) => x !== uid) : [...f.managerIds, uid],
    }));
  }

  if (loading) return <Skeleton.Rows count={6} />;

  const userMap = Object.fromEntries(users.map((u) => [u.uid, u]));
  // 관리자는 항상 모든 프로젝트 접근 가능하므로 후보에서 제외
  // 퇴사자는 앞으로 고르는 자리에 나오지 않는다 (과거 기록의 이름은 그대로 남는다)
  const candidates = users.filter((u) => u.role !== 'admin' && u.isActive !== false && isRealStaff(u));

  return (
    <div className="site-management-page">
      <div className="page-header">
        <h2>프로젝트 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            프로젝트 추가
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['sites']}
        title="프로젝트 휴지통"
        onChange={loadData}
      />

      <div className="table-scroll-x">
        <table className="table cards-sm">
          <thead>
            <tr>
              <th scope="col">프로젝트명</th>
              <th scope="col">팀</th>
              <th scope="col">담당자</th>
              <th scope="col" className="col-action">
                작업
              </th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td data-label="프로젝트명" title={s.name} style={{ wordBreak: 'break-word', minWidth: 80 }}>
                  {s.name}
                </td>
                <td data-label="팀">{s.team || '-'}</td>
                <td
                  data-label="담당자"
                  title={(s.managerIds || []).map((uid) => userMap[uid]?.name || uid).join(', ')}
                  style={{ maxWidth: 140, wordBreak: 'break-word', whiteSpace: 'normal', minWidth: 0 }}
                >
                  {(s.managerIds || []).map((uid) => userMap[uid]?.name || uid).join(', ') || '-'}
                </td>
                <td className="action-cell col-action">
                  <div className="btn-group">
                    <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}>
                      수정
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s)}>
                      <Icon name="trash" className="btn-ic" />
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr>
                <td colSpan="4">
                  <div className="text-muted text-center">등록된 프로젝트이 없습니다.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editSite ? '프로젝트 수정' : '프로젝트 추가'}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>프로젝트명 *</label>
            <input
              aria-label="프로젝트명"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="예: 메티스 프로버"
            />
          </div>
          <div className="form-group">
            <label>팀</label>
            <input
              aria-label="팀"
              value={form.team}
              onChange={(e) => setForm({ ...form, team: e.target.value })}
              placeholder="예: 전장 2팀"
            />
          </div>
          <div className="form-group">
            <label>담당자 선택</label>
            <p className="field-hint">관리자는 항상 모든 프로젝트에 접근 가능합니다. 그 외 담당 사용자만 체크하세요.</p>
            <button
              type="button"
              className="select-dropdown-toggle"
              onClick={() => setManagerListOpen(!managerListOpen)}
            >
              <span>{form.managerIds.length > 0 ? `${form.managerIds.length}명 선택됨` : '담당자를 선택하세요'}</span>
              <span
                className="select-dropdown-arrow"
                style={{ display: 'inline-flex', transform: managerListOpen ? 'rotate(180deg)' : 'none' }}
              >
                <Icon name="chevronDown" size={16} />
              </span>
            </button>
            {managerListOpen && (
              <div className="select-dropdown-list">
                {candidates.length === 0 && (
                  <p className="empty-state" style={{ padding: '12px', margin: 0 }}>
                    선택 가능한 사용자가 없습니다.
                  </p>
                )}
                {candidates.map((u) => {
                  const checked = form.managerIds.includes(u.uid);
                  return (
                    <label key={u.uid} className={`select-list-item ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleManager(u.uid)} />
                      <span className="select-list-name">{u.name}</span>
                      <span className="select-list-sub">
                        {u.code}
                        {u.position && ` · ${u.position}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>기본 업체 목록 (쉼표 구분)</label>
            <textarea
              aria-label="기본 업체 목록 (쉼표 구분)"
              value={vendorText}
              onChange={(e) => setVendorText(e.target.value)}
              rows={2}
              placeholder="업체명을 쉼표로 구분하여 입력"
            />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">
              {editSite ? '수정' : '추가'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
              취소
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
