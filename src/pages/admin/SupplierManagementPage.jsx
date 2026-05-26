import { useState, useEffect, useMemo } from 'react';
import { getSuppliers, addSupplier, updateSupplier, deleteSupplier } from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

const EMPTY_FORM = {
  name: '', representative: '', contact: '', businessNumber: '',
  bankName: '', bankAccount: '', category: '', note: '',
};

export default function SupplierManagementPage() {
  const { confirm, alert } = useDialog();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setSuppliers(await getSuppliers());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return suppliers;
    return suppliers.filter((s) =>
      [s.name, s.representative, s.contact, s.category, s.note]
        .some((v) => (v || '').toLowerCase().includes(kw)),
    );
  }, [suppliers, search]);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(s) {
    setEditTarget(s);
    setForm({
      name: s.name || '', representative: s.representative || '', contact: s.contact || '',
      businessNumber: s.businessNumber || '', bankName: s.bankName || '',
      bankAccount: s.bankAccount || '', category: s.category || '', note: s.note || '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) { alert('상호를 입력해주세요.'); return; }
    try {
      if (editTarget) {
        await updateSupplier(editTarget.id, form);
      } else {
        await addSupplier(form);
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(s) {
    if (!await confirm(`"${s.name}" 구매처를 삭제하시겠습니까?`)) return;
    try {
      await deleteSupplier(s.id);
      await loadData();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="supplier-management-page">
      <div className="page-header">
        <h2>구매처 관리</h2>
        <button className="btn btn-primary" onClick={openCreate}>구매처 추가</button>
      </div>

      <div className="purchase-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="상호 · 대표 · 연락처 · 분류 · 비고 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="purchase-empty">
          {suppliers.length === 0 ? '등록된 구매처가 없습니다.' : '검색 결과가 없습니다.'}
        </p>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>상호</th><th>대표</th><th>연락처</th><th>사업자번호</th>
              <th>분류</th><th>비고</th>
              <th className="bom-project-action-col">작업</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td data-label="상호"><strong>{s.name}</strong></td>
                <td data-label="대표">{s.representative || '-'}</td>
                <td data-label="연락처">{s.contact || '-'}</td>
                <td data-label="사업자번호">{s.businessNumber || '-'}</td>
                <td data-label="분류">{s.category || '-'}</td>
                <td data-label="비고" className="supplier-note-cell">{s.note || '-'}</td>
                <td className="bom-project-action-col">
                  <div className="btn-group">
                    <button className="btn btn-sm btn-outline" onClick={() => openEdit(s)}>수정</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s)}>삭제</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? '구매처 수정' : '구매처 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>상호 *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>대표자</label>
            <input type="text" value={form.representative} onChange={(e) => setForm({ ...form, representative: e.target.value })} />
          </div>
          <div className="form-group">
            <label>연락처</label>
            <input type="text" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div className="form-group">
            <label>사업자번호</label>
            <input type="text" value={form.businessNumber} onChange={(e) => setForm({ ...form, businessNumber: e.target.value })} />
          </div>
          <div className="form-group">
            <label>분류</label>
            <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="예: 자재, 공구, 소모품" />
          </div>
          <div className="form-group">
            <label>은행</label>
            <input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </div>
          <div className="form-group">
            <label>계좌번호</label>
            <input type="text" value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
          </div>
          <div className="form-group">
            <label>메모</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editTarget ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
