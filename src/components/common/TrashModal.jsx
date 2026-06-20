import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { useDialog } from './DialogProvider';
import { getTrashByType, restoreTrashItem, purgeTrashItem } from '../../services/trashService';

const TYPE_LABEL = {
  departments: { label: '부서', cls: 'ordered' },
  events: { label: '행사', cls: 'partial' },
  vendors: { label: '업체', cls: 'received' },
  freelancers: { label: '프리랜서', cls: 'received' },
  purchaseItems: { label: '품목', cls: 'ordered' },
  quotes: { label: '견적', cls: 'partial' },
  suppliers: { label: '구매처', cls: 'settled' },
  users: { label: '직원', cls: 'settled' },
  sites: { label: '현장', cls: 'ordered' },
  libraryFiles: { label: '파일', cls: 'partial' },
  libraryFolders: { label: '폴더', cls: 'received' },
  purchase: { label: '발주', cls: 'ordered' },
  bomProject: { label: 'BOM', cls: 'partial' },
  mileageLogs: { label: '운행기록', cls: 'partial' },
  vehicleMileages: { label: '운행기록', cls: 'partial' },
};

// 통일 휴지통 모달 — 어느 저장 페이지든 types만 넘기면 복원/영구삭제 제공
// <TrashModal isOpen={open} onClose={...} types={['suppliers']} title="구매처 휴지통" onChange={reload} />
export default function TrashModal({ isOpen, onClose, types, title = '휴지통', onChange }) {
  const { confirm, toast } = useDialog();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getTrashByType(types));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [types]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  async function handleRestore(id) {
    setBusy(id);
    try {
      await restoreTrashItem(id);
      toast('복원되었습니다.');
      await load();
      onChange?.();
    } catch (err) {
      toast(err?.message || '복원에 실패했습니다.', 'error');
    } finally {
      setBusy('');
    }
  }

  async function handlePurge(id) {
    if (!(await confirm({ title: '영구 삭제', message: '완전히 삭제하면 복구할 수 없습니다.\n계속할까요?' }))) return;
    setBusy(id);
    try {
      await purgeTrashItem(id);
      toast('영구 삭제되었습니다.');
      await load();
    } catch (err) {
      toast(err?.message || '삭제에 실패했습니다.', 'error');
    } finally {
      setBusy('');
    }
  }

  function fmtDateTime(d) {
    try {
      const dt = d?.toDate ? d.toDate() : d?.seconds ? new Date(d.seconds * 1000) : new Date(d);
      if (Number.isNaN(dt.getTime())) return '';
      const p = (n) => String(n).padStart(2, '0');
      return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
    } catch {
      return '';
    }
  }

  const typeInfo = (t) => TYPE_LABEL[t.type] || TYPE_LABEL[t.collection] || { label: t.type || '-', cls: 'ordered' };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <p className="field-hint" style={{ marginBottom: 12 }}>
        삭제된 항목이 보관됩니다. 복원하면 원래대로 되살아나고, 영구 삭제하면 되돌릴 수 없습니다.
      </p>
      {loading ? (
        <div className="trash-empty">불러오는 중...</div>
      ) : items.length === 0 ? (
        <div className="trash-empty">휴지통이 비어 있습니다.</div>
      ) : (
        <div className="table-scroll-x">
          <table className="table cards-sm">
            <thead>
              <tr>
                <th style={{ width: 64 }}>구분</th>
                <th>이름</th>
                <th>내용</th>
                <th style={{ width: 140 }}>삭제일시</th>
                <th style={{ width: 80 }}>삭제자</th>
                <th className="col-action" style={{ width: 140 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => {
                const { label, cls } = typeInfo(t);
                return (
                  <tr key={t.id}>
                    <td data-label="구분">
                      <span className={`purchase-badge purchase-badge-${cls}`}>{label}</span>
                    </td>
                    <td data-label="이름">
                      <strong>{t.title || '(이름 없음)'}</strong>
                    </td>
                    <td data-label="내용" style={{ color: 'var(--accent)', fontSize: 13 }}>
                      {t.summary || '-'}
                    </td>
                    <td data-label="삭제일시">{fmtDateTime(t.deletedAt)}</td>
                    <td data-label="삭제자">{t.deletedByName || '-'}</td>
                    <td data-label="작업" className="col-action">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        disabled={busy === t.id}
                        onClick={() => handleRestore(t.id)}
                        style={{ marginRight: 6 }}
                      >
                        복원
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={busy === t.id}
                        onClick={() => handlePurge(t.id)}
                      >
                        영구삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
