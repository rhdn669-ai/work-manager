import { useState, useEffect, useCallback } from 'react';
import Modal from './Modal';
import { useDialog } from './DialogProvider';
import { useAuth } from '../../contexts/AuthContext';
import TrashList from './TrashList';
import { getTrashByType, restoreTrashItem, purgeTrashItem } from '../../services/trashService';

// 통일 휴지통 모달 — 어느 저장 페이지든 types만 넘기면 복원/영구삭제 제공
// 영구삭제(purgeTrashItem)는 관리자(isAdmin)에게만 노출된다.
// <TrashModal isOpen={open} onClose={...} types={['suppliers']} title="구매처 휴지통" onChange={reload} />
export default function TrashModal({ isOpen, onClose, types, title = '휴지통', onChange }) {
  const { confirm, toast } = useDialog();
  const { isAdmin } = useAuth();
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
    if (!isAdmin) return;
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <p className="field-hint" style={{ marginBottom: 12 }}>
        삭제된 항목이 보관됩니다. 복원하면 원래대로 되살아납니다.
        {isAdmin ? ' 영구 삭제는 되돌릴 수 없습니다.' : ' 영구 삭제는 관리자만 할 수 있습니다.'}
      </p>
      <TrashList
        items={items}
        loading={loading}
        busy={busy}
        onRestore={handleRestore}
        onPurge={handlePurge}
        canPurge={isAdmin}
      />
    </Modal>
  );
}
