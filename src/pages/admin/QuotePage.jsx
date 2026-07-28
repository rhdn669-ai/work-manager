import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getQuotes } from '../../services/quoteService';
import { trashGeneric } from '../../services/trashService';
import { saveCompanyInfo } from '../../services/companyInfoService';
import { useAuth } from '../../contexts/useAuth';
import { useCompanyInfo } from '../../contexts/useCompanyInfo';
import TrashModal from '../../components/common/TrashModal';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/useDialog';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';

const INFO_FIELDS = [
  { key: 'companyAndCeo', label: '회사명/대표' },
  { key: 'businessNumber', label: '사업자등록번호' },
  { key: 'address', label: '주소' },
  { key: 'telFax', label: 'TEL/FAX' },
  { key: 'email', label: 'E-Mail' },
  { key: 'contact', label: '담당/연락처' },
];

function fmtDateKo(ts) {
  const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export default function QuotePage() {
  const navigate = useNavigate();
  const { confirm, toast } = useDialog();
  const { userProfile } = useAuth();
  const { info: companyInfo, refresh: refreshCompanyInfo } = useCompanyInfo();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(companyInfo);
  const [savingSettings, setSavingSettings] = useState(false);

  function openSettings() {
    setSettingsForm(companyInfo);
    setSettingsOpen(true);
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await saveCompanyInfo(settingsForm);
      refreshCompanyInfo();
      setSettingsOpen(false);
      toast('견적서·발주서·BOM 양식에 공통 반영되었습니다.');
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    } finally {
      setSavingSettings(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setQuotes(await getQuotes());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return quotes;
    return quotes.filter((q) =>
      [q.title, q.supplierName, q.siteName].some((v) => (v || '').toLowerCase().includes(kw)),
    );
  }, [quotes, search]);

  async function handleDelete(e, q) {
    e.stopPropagation();
    if (!(await confirm(`"${q.title}" 견적서를 삭제하시겠습니까?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      await trashGeneric(
        'quotes',
        q.id,
        { title: q.title, summary: [q.supplierName, q.siteName].filter(Boolean).join(' · ') },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      await loadAll();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="quote-page">
      <style>{`
        .quote-page .table th, .quote-page .table td { vertical-align: middle; }
        .quote-page .table tbody tr { min-height: 36px; }
        .quote-page .table tbody tr td { padding-top: 8px; padding-bottom: 8px; }
        .quote-cell-clamp { min-width: 80px; max-width: 160px; }
        .quote-cell-clamp-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; white-space: normal; min-width: 0; }
        @media (max-width: 430px) { .quote-cell-clamp { max-width: 110px !important; } }
        @media (max-width: 360px) { .quote-cell-clamp { max-width: 88px !important; } }
      `}</style>

      <div className="page-header">
        <h2>견적서 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={openSettings}>
            <Icon name="edit" className="btn-ic" />
            양식 설정
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/admin/purchase/quotes/new')}
          >
            <Icon name="plus" className="btn-ic" />
            견적서 작성
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['quotes']}
        title="견적 휴지통"
        onChange={loadAll}
      />

      <Modal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="견적서·발주서·BOM 양식 설정">
        <p className="field-hint">
          여기서 수정하면 견적서·발주서·BOM 리스트 3종 출력물의 발행처 정보에 공통으로 반영됩니다.
        </p>
        <form onSubmit={handleSaveSettings}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
            {INFO_FIELDS.map((f) => (
              <div className="form-group" key={f.key} style={{ margin: 0 }}>
                <label>{f.label}</label>
                <input
                  type="text"
                  value={settingsForm[f.key] || ''}
                  onChange={(e) => setSettingsForm({ ...settingsForm, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="form-actions" style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={savingSettings}>
              {savingSettings ? '저장 중...' : '저장'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setSettingsOpen(false)}>
              취소
            </button>
          </div>
        </form>
      </Modal>

      <div className="purchase-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="제목 · 거래처 · 현장 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="purchase-empty">
          {quotes.length === 0
            ? '등록된 견적서가 없습니다. 우측 상단 "견적서 작성"으로 시작하세요.'
            : '검색 결과가 없습니다.'}
        </p>
      ) : (
        <div className="table-scroll-x">
          <table className="table cards-sm" style={{ '--row-min-h': '36px' }}>
            <thead>
              <tr style={{ height: 36 }}>
                <th>제목</th>
                <th>거래처</th>
                <th>현장</th>
                <th style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>공급가액</th>
                <th style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>합계</th>
                <th>작성일</th>
                <th className="bom-project-action-col">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr
                  key={q.id}
                  className="table-clickable-row"
                  style={{ minHeight: 36 }}
                  onClick={() => navigate(`/admin/purchase/quotes/${q.id}`)}
                >
                  <td data-label="제목" title={q.title || ''}>
                    <strong>{q.title}</strong>
                  </td>
                  <td data-label="거래처" className="quote-cell-clamp">
                    <span className="quote-cell-clamp-text" title={q.supplierName || ''}>
                      {q.supplierName || '-'}
                    </span>
                  </td>
                  <td data-label="현장" className="quote-cell-clamp">
                    <span className="quote-cell-clamp-text" title={q.siteName || ''}>
                      {q.siteName || '-'}
                    </span>
                  </td>
                  <td data-label="공급가액" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {Number(q.totalAmount || 0).toLocaleString()}원
                  </td>
                  <td data-label="합계" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{Number(q.grandTotal || 0).toLocaleString()}원</strong>
                  </td>
                  <td data-label="작성일">{fmtDateKo(q.createdAt)}</td>
                  <td className="bom-project-action-col action-cell" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-sm btn-danger" onClick={(e) => handleDelete(e, q)}>
                      <Icon name="trash" className="btn-ic" />
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
