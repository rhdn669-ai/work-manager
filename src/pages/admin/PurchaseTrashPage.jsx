import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getTrashItems, restoreTrashItem, purgeTrashItem,
} from '../../services/trashService';
import { useDialog } from '../../components/common/DialogProvider';

const TYPE_LABEL = {
  purchase: { label: '발주', cls: 'ordered' },
  bomProject: { label: '프로젝트 BOM', cls: 'partial' },
};

// type 파라미터별 화면 구성
const VIEW = {
  purchase: { title: '구매·발주 휴지통', backTo: '/admin/purchase', backLabel: '구매 현황' },
  bomProject: { title: '프로젝트 BOM 휴지통', backTo: '/admin/purchase/bom', backLabel: '프로젝트별 BOM' },
};

function fmtDateTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function PurchaseTrashPage() {
  const { confirm, alert } = useDialog();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type'); // 'purchase' | 'bomProject' | null
  const view = VIEW[typeFilter] || { title: '휴지통', backTo: '/admin/purchase', backLabel: '구매 현황' };
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  const shown = useMemo(
    () => (typeFilter ? items.filter((t) => t.type === typeFilter) : items),
    [items, typeFilter],
  );

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setItems(await getTrashItems());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(t) {
    if (!await confirm(`"${t.title}"을(를) 복원하시겠습니까?`)) return;
    setBusyId(t.id);
    try {
      await restoreTrashItem(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
      if (t.type === 'purchase') {
        if (await confirm('복원 완료. 해당 발주로 이동할까요?')) navigate(`/admin/purchase/${t.refId}`);
      } else if (t.type === 'bomProject') {
        if (await confirm('복원 완료. 해당 프로젝트 BOM으로 이동할까요?')) navigate(`/admin/purchase/bom/${t.refId}`);
      }
    } catch (err) {
      alert('복원 중 오류: ' + err.message);
    } finally {
      setBusyId('');
    }
  }

  async function handlePurge(t) {
    if (!await confirm(`"${t.title}"을(를) 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    setBusyId(t.id);
    try {
      await purgeTrashItem(t.id);
      setItems((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    } finally {
      setBusyId('');
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-list-page">
      <div className="page-header">
        <h2>{view.title}</h2>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={() => navigate(view.backTo)}>{view.backLabel}</button>
        </div>
      </div>

      <p className="field-hint" style={{ marginBottom: 12 }}>
        삭제된 항목이 보관됩니다. 복원하면 원래대로 되살아나고, 영구 삭제하면 되돌릴 수 없습니다.
      </p>

      {shown.length === 0 ? (
        <p className="purchase-empty">휴지통이 비어 있습니다.</p>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>구분</th>
              <th>이름</th>
              <th>내용</th>
              <th>삭제일시</th>
              <th>삭제자</th>
              <th style={{ textAlign: 'right' }}>작업</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id}>
                <td data-label="구분">
                  <span className={`purchase-badge purchase-badge-${TYPE_LABEL[t.type]?.cls || 'ordered'}`}>
                    {TYPE_LABEL[t.type]?.label || t.type}
                  </span>
                </td>
                <td data-label="이름"><strong>{t.title}</strong></td>
                <td data-label="내용">{t.summary || '-'}</td>
                <td data-label="삭제일시">{fmtDateTime(t.deletedAt)}</td>
                <td data-label="삭제자">{t.deletedByName || '-'}</td>
                <td data-label="작업" style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleRestore(t)}
                    disabled={busyId === t.id}
                    style={{ marginRight: 6 }}
                  >복원</button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handlePurge(t)}
                    disabled={busyId === t.id}
                  >영구삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
