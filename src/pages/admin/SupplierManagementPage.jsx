import { useState, useEffect, useMemo, useRef } from 'react';
import { getSuppliers, addSupplier, updateSupplier } from '../../services/purchaseService';
import { trashGeneric } from '../../services/trashService';
import { ensureFolderPath, uploadFile } from '../../services/fileLibraryService';
import { extractBizInfo, normalizeCompany, isSupportedBizFile } from '../../utils/bizPdf';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import { useDialog } from '../../components/common/useDialog';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';

import { PAYMENT_TERM_TYPES, paymentTermLabel } from '../../utils/paymentTerms';

const EMPTY_FORM = {
  name: '',
  representative: '',
  contact: '',
  email: '',
  emails: [], // 담당자 여러 명 — [{ name, email }]. 첫 줄이 대표
  ccEmails: '', // 참조(CC) — 담당이 누구든 늘 함께 받는 사람. 쉼표로 여러 명
  businessNumber: '',
  bankName: '',
  bankAccount: '',
  category: '',
  paymentTermType: '', // 결제 조건 — 발주 결제 요청 시 마감일을 이 조건으로 계산한다
  paymentTermDay: '',
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
      emails: Array.isArray(s.emails) && s.emails.length ? s.emails : s.email ? [{ name: '', email: s.email }] : [],
      ccEmails: s.ccEmails || '',
      businessNumber: s.businessNumber || '',
      bankName: s.bankName || '',
      bankAccount: s.bankAccount || '',
      category: s.category || '',
      paymentTermType: s.paymentTermType || '',
      paymentTermDay: s.paymentTermDay ?? '',
      note: s.note || '',
    });
    setPdfFiles([]);
    setPdfStatus('');
    setShowModal(true);
  }

  // PDF·이미지(여러 개 가능) 처리 → 텍스트/OCR 자동 입력 + 자료실 보관
  // 사업자등록증·통장사본을 한 번에(PDF든 사진이든) 붙이면 각자에서 잡힌 값을 합쳐 채움
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    if (!form.name.trim()) {
      alert('상호를 입력해주세요.');
      return;
    }
    const supplierName = normalizeCompany(form.name) || form.name.trim(); // 주식회사 → (주) 통일
    const filesToUpload = pdfFiles;
    // 담당자 줄 — 메일이 빈 줄은 버리고, 첫 줄을 대표(email)로 맞춰 둔다.
    // 예전 화면·메일 로직이 email 한 칸을 보고 있어 이 동기화가 있어야 안 깨진다.
    const cleanEmails = (form.emails || [])
      .map((c) => ({ name: String(c?.name ?? '').trim(), email: String(c?.email ?? '').trim() }))
      .filter((c) => c.email);
    const data = {
      ...form,
      name: supplierName,
      emails: cleanEmails,
      email: cleanEmails[0]?.email || String(form.email || '').trim(),
    };
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
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    // 첨부 PDF들은 모달 닫은 뒤 백그라운드로 자료실 "거래처 정보/{업체명}" 폴더에 보관
    if (filesToUpload.length > 0) {
      try {
        const folderId = await ensureFolderPath(['거래처 정보', supplierName], userProfile, { protected: true });
        for (let i = 0; i < filesToUpload.length; i += 1) {
          await uploadFile(
            filesToUpload[i],
            folderId,
            userProfile,
            undefined,
            `${supplierName}_${filesToUpload[i].name}`,
          );
        }
      } catch {
        toast('PDF 자료실 보관 중 오류가 발생했습니다', 'error');
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
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

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
                <th scope="col" style={{ width: 172 }}>
                  상호
                </th>
                <th scope="col" style={{ width: 76 }}>
                  대표
                </th>
                <th scope="col" style={{ width: 130 }}>
                  연락처
                </th>
                <th scope="col" style={{ width: 202 }}>
                  이메일
                </th>
                <th scope="col" style={{ width: 122 }}>
                  사업자번호
                </th>
                <th scope="col" style={{ width: 94 }}>
                  은행
                </th>
                <th scope="col" style={{ width: 158 }}>
                  계좌번호
                </th>
                <th scope="col" className="hide-mobile" style={{ width: 92 }}>
                  결제 조건
                </th>
                <th scope="col" className="hide-mobile" style={{ width: 144 }}>
                  분류
                </th>
                <th scope="col" className="hide-mobile" style={{ minWidth: 260 }}>
                  비고
                </th>
                <th scope="col" className="bom-project-action-col">
                  작업
                </th>
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
                  <td data-label="결제 조건" className="u-ellipsis hide-mobile">
                    {paymentTermLabel(s) || '-'}
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

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? '구매처 수정' : '구매처 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>파일 첨부 — 사업자등록증·통장사본 (PDF·사진, 자동 입력 + 자료실 보관)</label>
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
                  : 'PDF·사진을 끌어다 놓거나 클릭해서 선택 (여러 개 가능)'}
              </span>
            </div>
            <p className="field-hint">
              {pdfBusy
                ? pdfStatus || '파일 처리 중…'
                : pdfFiles.length
                  ? `${pdfStatus ? pdfStatus + ' · ' : ''}${pdfFiles.map((f) => f.name).join(', ')} — 저장 시 자료실 "거래처 정보/${normalizeCompany(form.name) || form.name.trim() || '상호'}" 폴더에 보관됩니다.`
                  : '사업자등록증·통장사본을 한 번에(PDF든 사진이든) 첨부하면 둘 다 인식해 상호·대표자·사업자번호·은행·계좌를 채웁니다. 텍스트·스캔·사진 모두 가능(스캔·사진은 OCR).'}
            </p>
          </div>
          <div className="form-group">
            <label>상호 *</label>
            <input
              aria-label="상호"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>대표자</label>
            <input
              aria-label="대표자"
              type="text"
              value={form.representative}
              onChange={(e) => setForm({ ...form, representative: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>연락처</label>
            <input
              aria-label="연락처"
              type="text"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </div>
          {/* 한 업체 안에서도 취급 제품에 따라 받는 사람이 다르다(예: COSEL 담당 / 델타 담당).
              첫 줄이 대표 — 품목에서 담당자를 고르지 않으면 대표로 간다. */}
          <div className="form-group">
            <label>이메일</label>
            <div className="sup-mail-list">
              {(form.emails.length ? form.emails : [{ name: '', email: form.email || '' }]).map((c, i) => (
                <div key={i} className="sup-mail-row">
                  <input
                    className="sup-mail-name"
                    aria-label={`담당자 ${i + 1} 이름`}
                    value={c.name || ''}
                    placeholder="담당(예: COSEL)"
                    onChange={(e) => {
                      const next = [...(form.emails.length ? form.emails : [{ name: '', email: form.email || '' }])];
                      next[i] = { ...next[i], name: e.target.value };
                      setForm({ ...form, emails: next });
                    }}
                  />
                  <input
                    type="email"
                    aria-label={`담당자 ${i + 1} 이메일`}
                    value={c.email || ''}
                    placeholder="예: sales@company.com"
                    onChange={(e) => {
                      const next = [...(form.emails.length ? form.emails : [{ name: '', email: form.email || '' }])];
                      next[i] = { ...next[i], email: e.target.value };
                      setForm({ ...form, emails: next, email: i === 0 ? e.target.value : form.email });
                    }}
                  />
                  {i === 0 ? (
                    <span className="sup-mail-badge">대표</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setForm({ ...form, emails: form.emails.filter((_, j) => j !== i) })}
                    >
                      <Icon name="trash" className="btn-ic" />
                      삭제
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => {
                const base = form.emails.length ? form.emails : [{ name: '', email: form.email || '' }];
                setForm({ ...form, emails: [...base, { name: '', email: '' }] });
              }}
            >
              <Icon name="plus" className="btn-ic" />
              담당자 추가
            </button>
          </div>
          <div className="form-group">
            <label htmlFor="sup-cc">참조 (CC)</label>
            <input
              id="sup-cc"
              type="text"
              value={form.ccEmails}
              onChange={(e) => setForm({ ...form, ccEmails: e.target.value })}
              placeholder="sales@telcom.kr, mgr@telcom.kr"
            />
            <p className="field-hint">
              발주서를 보낼 때 담당자와 함께 늘 받는 사람입니다. 담당이 누구든 이 주소가 함께 들어갑니다. 여러 명은
              쉼표로 나눠 적으세요.
            </p>
          </div>
          <div className="form-group">
            <label>사업자번호</label>
            <input
              aria-label="사업자번호"
              type="text"
              value={form.businessNumber}
              onChange={(e) => setForm({ ...form, businessNumber: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>분류</label>
            <input
              aria-label="분류"
              type="text"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="예: 자재, 공구, 소모품"
            />
          </div>
          <div className="form-group">
            <label>은행</label>
            <input
              aria-label="은행"
              type="text"
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>계좌번호</label>
            <input
              aria-label="계좌번호"
              type="text"
              value={form.bankAccount}
              onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>결제 조건</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={form.paymentTermType}
                onChange={(e) => setForm({ ...form, paymentTermType: e.target.value })}
                style={{ flex: '1 1 auto', minWidth: 0 }}
                aria-label="결제 조건 종류"
              >
                {PAYMENT_TERM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {PAYMENT_TERM_TYPES.find((t) => t.value === form.paymentTermType)?.needsDay && (
                <>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={form.paymentTermDay}
                    onChange={(e) => setForm({ ...form, paymentTermDay: e.target.value })}
                    placeholder="숫자"
                    style={{ width: 90, flexShrink: 0 }}
                    aria-label="결제 조건 일수"
                  />
                  <span className="text-muted" style={{ flexShrink: 0 }}>
                    {PAYMENT_TERM_TYPES.find((t) => t.value === form.paymentTermType)?.unit}
                  </span>
                </>
              )}
            </div>
            <small className="text-muted">
              {paymentTermLabel(form)
                ? `발주 결제 요청 시 마감일이 「${paymentTermLabel(form)}」로 자동 계산됩니다.`
                : '지정하면 발주 결제 요청 시 마감일이 자동으로 채워집니다.'}
            </small>
          </div>
          <div className="form-group">
            <label>메모</label>
            <textarea
              aria-label="메모"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              rows={2}
            />
          </div>
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
              {submitting ? '저장 중…' : editTarget ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
