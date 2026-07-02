import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDialog } from '../../components/common/DialogProvider';
import { useAuth } from '../../contexts/AuthContext';
import Icon from '../../components/common/Icon';
import TrashList from '../../components/common/TrashList';
import { getTrashItems, restoreTrashItem, purgeTrashItem } from '../../services/trashService';

// 전역 휴지통 — 앱 전체의 삭제 기록을 한 곳에서 확인.
// 카테고리 탭으로 분리해 보여주고, 복원은 누구나(여기 진입 자체가 관리자 라우트), 영구삭제는 관리자만.
const TRASH_TABS = [
  { key: 'all', label: '전체', types: null },
  { key: 'purchase', label: '구매·발주', types: ['purchase', 'purchaseItems', 'suppliers'] },
  { key: 'quote', label: '견적', types: ['quotes'] },
  { key: 'bom', label: 'BOM', types: ['bomProject', 'bom'] },
  { key: 'site', label: '현장', types: ['sites'] },
  { key: 'closing', label: '공수표', types: ['siteClosingItems', 'siteFinances'] },
  { key: 'attendance', label: '근태·연차', types: ['overtimeRecords', 'leaves'] },
  { key: 'library', label: '자료실', types: ['libraryFiles', 'libraryFolders'] },
  { key: 'org', label: '직원·부서', types: ['users', 'departments'] },
  { key: 'outsource', label: '외주', types: ['vendors', 'freelancers'] },
  { key: 'schedule', label: '업무·일정', types: ['tasks', 'personalEvents'] },
  { key: 'event', label: '행사·공지', types: ['events'] },
  { key: 'vehicle', label: '운행기록', types: ['vehicleMileages', 'mileageLogs'] },
];

const typeOf = (t) => t.type || t.collection || '';

export default function TrashPage() {
  const { confirm, toast } = useDialog();
  const { isAdmin } = useAuth();
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAll(await getTrashItems());
    } catch {
      setAll([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 탭별 개수
  const counts = useMemo(() => {
    const c = { all: all.length };
    for (const tabDef of TRASH_TABS) {
      if (!tabDef.types) continue;
      const set = new Set(tabDef.types);
      c[tabDef.key] = all.filter((t) => set.has(typeOf(t))).length;
    }
    return c;
  }, [all]);

  const activeTab = TRASH_TABS.find((t) => t.key === tab) || TRASH_TABS[0];
  const items = useMemo(() => {
    if (!activeTab.types) return all;
    const set = new Set(activeTab.types);
    return all.filter((t) => set.has(typeOf(t)));
  }, [all, activeTab]);

  async function handleRestore(id) {
    setBusy(id);
    try {
      await restoreTrashItem(id);
      toast('복원되었습니다.');
      await load();
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

  // 현재 탭에 보이는 항목 전부 영구 삭제 (관리자 전용)
  async function handlePurgeAll() {
    if (!isAdmin || items.length === 0) return;
    const scope = activeTab.types ? `'${activeTab.label}' 분류의 ` : '휴지통의 모든 ';
    if (
      !(await confirm({
        title: '전체 영구 삭제',
        message: `${scope}${items.length}건을 완전히 삭제합니다.\n복구할 수 없습니다. 계속할까요?`,
      }))
    )
      return;
    setBusy('__all__');
    try {
      await Promise.all(items.map((t) => purgeTrashItem(t.id)));
      toast(`${items.length}건 영구 삭제되었습니다.`);
      await load();
    } catch (err) {
      toast(err?.message || '삭제에 실패했습니다.', 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="trash-page">
      <div className="page-header">
        <h2>휴지통</h2>
        <div className="page-actions no-print">
          <button type="button" className="btn btn-sm btn-outline" onClick={load} disabled={loading}>
            <Icon name="restore" className="btn-ic" />
            새로고침
          </button>
          {isAdmin && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={handlePurgeAll}
              disabled={loading || busy === '__all__' || items.length === 0}
              title="현재 분류에 보이는 삭제기록을 모두 영구 삭제합니다"
            >
              <Icon name="trash" className="btn-ic" />
              {activeTab.types ? '이 분류 전체 삭제' : '휴지통 비우기'}
              {items.length > 0 ? ` (${items.length})` : ''}
            </button>
          )}
        </div>
      </div>

      <p className="field-hint" style={{ margin: '0 0 12px' }}>
        앱 전체의 삭제 기록입니다. 복원하면 원래 위치로 되살아납니다.
        {isAdmin ? ' 영구 삭제는 되돌릴 수 없습니다.' : ' 영구 삭제는 관리자만 할 수 있습니다.'}
      </p>

      <div className="tab-nav closing-tab-nav no-print">
        {TRASH_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-nav-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="tab-nav-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <TrashList
        items={items}
        loading={loading}
        busy={busy}
        onRestore={handleRestore}
        onPurge={handlePurge}
        canPurge={isAdmin}
        emptyText="이 분류의 삭제 기록이 없습니다."
      />
    </div>
  );
}
