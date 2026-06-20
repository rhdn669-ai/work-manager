import { useState, useEffect, useMemo, useRef } from 'react';
import { getSuppliers, addSupplier, updateSupplier } from '../../services/purchaseService';
import { trashGeneric } from '../../services/trashService';
import { ensureFolderPath, uploadFile } from '../../services/fileLibraryService';
import { extractBizInfo, normalizeCompany } from '../../utils/bizPdf';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import { useDialog } from '../../components/common/DialogProvider';
import Icon from '../../components/common/Icon';

const EMPTY_FORM = {
  name: '',
  representative: '',
  contact: '',
  email: '',
  businessNumber: '',
  bankName: '',
  bankAccount: '',
  category: '',
  note: '',
};

export default function SupplierManagementPage() {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [pdfFiles, setPdfFiles] = useState([]); // 자료실에 보관할 PDF들 (사업자등록증·통장사본 등)
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState(''); // 진행 상태 문구
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pdfInputRef = useRef(null);

  useEffect(() => {
    loadData();
  }, []);

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
      [s.name, s.representative, s.contact, s.email, s.category, s.note].some((v) =>
        (v || '').toLowerCase().includes(kw),
      ),
    );
  }, [suppliers, search]);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setPdfFiles([]);
    setPdfStatus('');
    setShowModal(true);
  }

  function openEdit(s) {
    setEditTarget(s);
    setForm({
      name: s.name || '',
      representative: s.representative || '',
      contact: s.contact || '',
      email: s.email || '',
      businessNumber: s.businessNumber || '',
      bankName: s.bankName || '',
      bankAccount: s.bankAccount || '',
      category: s.category || '',
      note: s.note || '',
    });
    setPdfFiles([]);
    setPdfStatus('');
    setShowModal(true);
  }

  // PDF(여러 개 가능) 처리 → 텍스트/OCR 자동 입력 + 자료실 보관용 보관
  // 사업자등록증·통장사본을 한 번에 붙이면 각자에서 잡힌 값을 합쳐 채움
  async function handlePdfFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (files.length === 0) {
      alert('PDF 파일만 가능합니다.');
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
    } catch (err) {
      setPdfStatus('');
      alert('PDF 처리 오류: ' + err.message);
    } finally {
      setPdfBusy(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    if (!form.name.trim()) {
      alert('상호를 입력해주세요.');
      return;
    }
    const supplierName = normalizeCompany(form.name) || form.name.trim(); // 주식회사 → (주) 통일
    const filesToUpload = pdfFiles;
    const data = { ...form, name: supplierName };
    setSubmitting(true);
    try {
      if (editTarget) {
        await updateSupplier(editTarget.id, data);
      } else {
        await addSupplier(data);
      }
      // 저장 완료 → 모달 즉시 닫고 목록 갱신 (PDF 업로드를 기다리지 않음)
      setShowModal(false);
      setPdfFiles([]);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    // 첨부 PDF들은 모달 닫은 뒤 백그라운드로 자료실 "거래처 정보/{업체명}" 폴더에 보관
    if (filesToUpload.length > 0) {
      try {
        const folderId = await ensureFolderPath(['거래처 정보', supplierName], userProfile);
        for (let i = 0; i < filesToUpload.length; i += 1) {
          await uploadFile(
            filesToUpload[i],
            folderId,
            userProfile,
            undefined,
            `${supplierName}_${filesToUpload[i].name}`,
          );
        }
      } catch (err) {
        alert('PDF 자료실 보관 중 오류: ' + err.message);
      }
    }
  }

  async function handleDelete(s) {
    if (
      !(await confirm({
        title: '구매처 삭제',
        message: `"${s.name}" 구매처를 삭제할까요?\n휴지통에서 복원할 수 있습니다.`,
      }))
    )
      return;
    try {
      await trashGeneric(
        'suppliers',
        s.id,
        {
          title: s.name,
          summary: [s.representative, s.businessNumber].filter(Boolean).join(' · '),
        },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
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
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            구매처 추가
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['suppliers']}
        title="구매처 휴지통"
        onChange={loadData}
      />

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
        <div className="table-scroll-x">
          <table className="table cards-sm supplier-table">
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
                <th className="hide-mobile">비고</th>
                <th className="bom-project-action-col">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td data-label="상호" title={s.name || ''}>
                    <strong>{s.name}</strong>
                  </td>
                  <td data-label="대표" className="u-ellipsis" title={s.representative || ''}>
                    {s.representative || '-'}
                  </td>
                  <td data-label="연락처" className="u-ellipsis" title={s.contact || ''}>
                    {s.contact || '-'}
                  </td>
                  <td data-label="이메일" className="u-ellipsis" title={s.email || ''}>
                    {s.email || '-'}
                  </td>
                  <td data-label="사업자번호" className="u-ellipsis" title={s.businessNumber || ''}>
                    {s.businessNumber || '-'}
                  </td>
                  <td data-label="은행" className="u-ellipsis" title={s.bankName || ''}>
                    {s.bankName || '-'}
                  </td>
                  <td data-label="계좌번호" className="u-wrap" title={s.bankAccount || ''}>
                    {s.bankAccount || '-'}
                  </td>
                  <td data-label="분류" className="u-ellipsis hide-mobile" title={s.category || ''}>
                    {s.category || '-'}
                  </td>
                  <td data-label="비고" className="supplier-note-cell hide-mobile" title={s.note || ''}>
                    <span className="cell-clamp-2">{s.note || '-'}</span>
                  </td>
                  <td className="bom-project-action-col">
                    <div className="btn-group" style={{ alignItems: 'stretch' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => openEdit(s)}
                        title="수정"
                        aria-label="수정"
                        style={{ minHeight: 36 }}
                      >
                        수정
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(s)}
                        title="삭제"
                        aria-label="삭제"
                        style={{ minHeight: 36 }}
                      >
                        <Icon name="trash" className="btn-ic" />삭제
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? '구매처 수정' : '구매처 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>PDF 첨부 — 사업자등록증·통장사본 (자동 입력 + 자료실 보관)</label>
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
                accept="application/pdf,.pdf"
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
            <p className="field-hint">
              {pdfBusy
                ? pdfStatus || 'PDF 처리 중…'
                : pdfFiles.length
                  ? `${pdfStatus ? pdfStatus + ' · ' : ''}${pdfFiles.map((f) => f.name).join(', ')} — 저장 시 자료실 "거래처 정보/${normalizeCompany(form.name) || form.name.trim() || '상호'}" 폴더에 보관됩니다.`
                  : '사업자등록증·통장사본을 한 번에 첨부하면 둘 다 인식해 상호·대표자·사업자번호·은행·계좌를 채웁니다. 텍스트·스캔 PDF 모두 가능(스캔은 OCR).'}
            </p>
          </div>
          <div className="form-group">
            <label>상호 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>대표자</label>
            <input
              type="text"
              value={form.representative}
              onChange={(e) => setForm({ ...form, representative: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>연락처</label>
            <input type="text" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div className="form-group">
            <label>이메일</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="예: sales@company.com"
            />
          </div>
          <div className="form-group">
            <label>사업자번호</label>
            <input
              type="text"
              value={form.businessNumber}
              onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>분류</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="예: 자재, 공구, 소모품"
            />
          </div>
          <div className="form-group">
            <label>은행</label>
            <input type="text" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
          </div>
          <div className="form-group">
            <label>계좌번호</label>
            <input
              type="text"
              value={form.bankAccount}
              onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>메모</label>
            <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={2} />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ minHeight: 36 }}>
              {submitting ? '저장 중…' : editTarget ? '수정' : '추가'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowModal(false)}
              disabled={submitting}
              style={{ minHeight: 36 }}
            >
              취소
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
