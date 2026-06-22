import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/DialogProvider';
import { useUndo } from '../../contexts/UndoContext';
import {
  subscribeFolders,
  subscribeFiles,
  createFolder,
  renameFolder,
  uploadFile,
  moveFile,
  moveFolder,
  setFolderOrder,
} from '../../services/fileLibraryService';
import { trashGeneric, subscribeTrashByType, restoreTrashItem } from '../../services/trashService';
import TrashModal from '../../components/common/TrashModal';

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

function getFileIconName(name = '', contentType = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (contentType.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','bmp','heic'].includes(ext)) return 'image';
  if (contentType.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return 'video';
  if (contentType.startsWith('audio/') || ['mp3','wav','m4a'].includes(ext)) return 'music';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return 'archive';
  return 'doc';
}

// 폴더 ID → 조상 ID 목록
function getAncestorIds(folderId, folders) {
  const map = Object.fromEntries(folders.map((f) => [f.id, f]));
  const result = [];
  let cur = map[folderId];
  while (cur?.parentId) { result.push(cur.parentId); cur = map[cur.parentId]; }
  return result;
}

// 폴더 정렬 — 자동생성 "자료" 폴더는 형제 중 항상 최상단, 그 외는 order(드래그 순서)순
function sortFolders(a, b) {
  const ap = a.protected && a.name === '자료' ? 0 : 1;
  const bp = b.protected && b.name === '자료' ? 0 : 1;
  if (ap !== bp) return ap - bp;
  return (a.order ?? 1e9) - (b.order ?? 1e9);
}

// 폴더의 하위 전체(재귀) 통계 — 하위 폴더수·파일수 합산 + 가장 최근 저장시각
function getFolderStats(folderId, folders, files) {
  let folderCount = 0;
  let fileCount = 0;
  let latest = null;
  const bump = (ts) => {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    if (d && !Number.isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
  };
  for (const f of files) {
    if ((f.folderId || null) === folderId) {
      fileCount++;
      bump(f.createdAt);
    }
  }
  for (const sf of folders) {
    if ((sf.parentId || null) === folderId) {
      folderCount++;
      const s = getFolderStats(sf.id, folders, files);
      folderCount += s.folderCount;
      fileCount += s.fileCount;
      if (s.latest && (!latest || s.latest > latest)) latest = s.latest;
    }
  }
  return { folderCount, fileCount, latest };
}

// ── 트리 노드 ──
function TreeNode({ folder, folders, files, selectedId, onSelect, onRename, onDelete, dragOverId, dndProps, depth, openMap, toggleOpen, folderDragOverId, folderDropMode, draggingFolderId }) {
  const children = useMemo(
    () => folders.filter((f) => (f.parentId || null) === folder.id).sort(sortFolders),
    [folders, folder.id],
  );
  const fileCount = files.filter((f) => (f.folderId || null) === folder.id).length;
  const hasChildren = children.length > 0;
  const isOpen = openMap[folder.id] ?? false;
  const isActive = selectedId === folder.id;
  const isDragOver = dragOverId === folder.id;
  const isFolderTarget = folderDragOverId === folder.id && draggingFolderId !== folder.id;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={`lib-tree-row${isActive ? ' is-active' : ''}${isDragOver ? ' drag-over' : ''}${isFolderTarget && folderDropMode === 'before' ? ' drag-folder-before' : ''}${isFolderTarget && folderDropMode === 'after' ? ' drag-folder-after' : ''}${isFolderTarget && folderDropMode === 'inside' ? ' drag-folder-inside' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onSelect(folder.id)}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(folder.id)}
        {...dndProps(folder)}
      >
        <button
          type="button"
          className="lib-tree-caret"
          style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
          onClick={(e) => { e.stopPropagation(); toggleOpen(folder.id); }}
          tabIndex={-1}
          aria-label={isOpen ? '접기' : '펼치기'}
        >
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} />
        </button>
        <span className="lib-tree-ic"><Icon name="folder" /></span>
        <span className="lib-tree-name">{folder.name}</span>
        {fileCount > 0 && <span className="lib-tree-badge">{fileCount}</span>}
        {/* hover 시 노출되는 액션 버튼 — 자동생성(protected) 폴더는 숨김 */}
        {folder.protected ? (
          <span className="lib-tree-lock" title="자동 생성 폴더 (수정·삭제 불가)" aria-label="잠긴 폴더">
            <Icon name="lock" />
          </span>
        ) : (
          <span className="lib-tree-actions" onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lib-tree-act"
              title="이름 변경"
              aria-label="이름 변경"
              onClick={(e) => { e.stopPropagation(); onRename(folder); }}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              className="lib-tree-act lib-tree-act--del"
              title="폴더 삭제"
              aria-label="폴더 삭제"
              onClick={(e) => { e.stopPropagation(); onDelete(folder); }}
            >
              <Icon name="trash" />
            </button>
          </span>
        )}
      </div>
      {isOpen && children.map((child) => (
        <TreeNode
          key={child.id}
          folder={child}
          folders={folders}
          files={files}
          selectedId={selectedId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          dragOverId={dragOverId}
          dndProps={dndProps}
          depth={depth + 1}
          openMap={openMap}
          toggleOpen={toggleOpen}
          folderDragOverId={folderDragOverId}
          folderDropMode={folderDropMode}
          draggingFolderId={draggingFolderId}
        />
      ))}
    </>
  );
}

export default function FileLibraryPage() {
  const { userProfile, canViewArchive, isAdmin } = useAuth();
  const { confirm, alert, toast } = useDialog();
  const { push: pushUndo } = useUndo();

  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = 전체
  const [openMap, setOpenMap] = useState({});

  const [draggingFileId, setDraggingFileId] = useState(null);
  const [dragOverId, setDragOverId] = useState(undefined);
  const [draggingFolderId, setDraggingFolderId] = useState(null);
  const [folderDragOverId, setFolderDragOverId] = useState(undefined);
  // 폴더 드롭 위치: 'before'(앞 형제) | 'after'(뒤 형제) | 'inside'(하위폴더로 삽입)
  const [folderDropMode, setFolderDropMode] = useState('inside');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState('');

  const [uploads, setUploads] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // 관리자가 자물쇠를 눌러 일시 해제한 잠금(protected) 폴더 ID 모음.
  // 영구 변경이 아니라 현재 화면에서만 유효 — 새로고침/재진입하면 다시 잠긴다.
  const [unlocked, setUnlocked] = useState(() => new Set());
  const isFolderUnlocked = (folder) => !!folder && isAdmin && unlocked.has(folder.id);
  function toggleFolderLock(folder, e) {
    e?.stopPropagation();
    if (!isAdmin || !folder?.protected) return;
    setUnlocked((prev) => {
      const next = new Set(prev);
      if (next.has(folder.id)) {
        next.delete(folder.id);
        toast(`"${folder.name}" 폴더를 다시 잠갔습니다.`);
      } else {
        next.add(folder.id);
        toast(`"${folder.name}" 폴더 잠금을 일시 해제했습니다. 수정·삭제할 수 있습니다(새로고침하면 다시 잠김).`, 'success', 0);
      }
      return next;
    });
  }

  useEffect(() => {
    const unsubF = subscribeFolders(setFolders);
    const unsubFiles = subscribeFiles(setFiles);
    const unsubTrash = subscribeTrashByType(['libraryFiles', 'libraryFolders'], (items) => setTrashCount(items.length));
    return () => { unsubF(); unsubFiles(); unsubTrash(); };
  }, []);

  // 선택 폴더 변경 시 조상 자동 펼침
  useEffect(() => {
    if (!selectedFolderId) return;
    const ancestors = getAncestorIds(selectedFolderId, folders);
    if (ancestors.length === 0) return;
    setOpenMap((prev) => {
      const next = { ...prev };
      ancestors.forEach((id) => { next[id] = true; });
      return next;
    });
  }, [selectedFolderId, folders]);

  const topFolders = useMemo(
    () => folders.filter((f) => (f.parentId || null) === null).sort(sortFolders),
    [folders],
  );

  const selectedFolder = selectedFolderId !== null ? folders.find((f) => f.id === selectedFolderId) : null;

  // 현재 폴더의 하위 폴더 (탐색기: 폴더가 위)
  const currentSubFolders = useMemo(
    () => folders.filter((f) => (f.parentId || null) === selectedFolderId).sort(sortFolders),
    [folders, selectedFolderId],
  );

  // 현재 폴더의 파일 (전체=null이면 미분류 파일). 검색은 현재 폴더 내에서.
  const currentFiles = useMemo(() => {
    const kw = search.trim().toLowerCase();
    let base = files.filter((f) => (f.folderId || null) === selectedFolderId);
    if (kw) base = base.filter((f) => (f.name || '').toLowerCase().includes(kw));
    return base;
  }, [files, selectedFolderId, search]);

  // 브레드크럼 경로 [최상위 … 현재]
  const breadcrumb = useMemo(() => {
    const path = [];
    let cur = selectedFolderId ? folders.find((f) => f.id === selectedFolderId) : null;
    while (cur) { path.unshift(cur); cur = cur.parentId ? folders.find((f) => f.id === cur.parentId) : null; }
    return path;
  }, [selectedFolderId, folders]);

  function selectFolder(id) {
    setSelectedFolderId(id);
    setSearch('');
    setSelected(new Set());
  }

  function toggleOpen(id) {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // ── 다중 선택 ──
  const allSelected = currentFiles.length > 0 && currentFiles.every((f) => selected.has(f.id));
  function toggleSelect(id, e) {
    e?.stopPropagation();
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(() => allSelected ? new Set() : new Set(currentFiles.map((f) => f.id)));
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!(await confirm({ title: '파일 삭제', message: `선택한 ${selected.size}개 파일을 삭제할까요?` }))) return;
    for (const f of files.filter((x) => selected.has(x.id))) {
      try { await trashGeneric('libraryFiles', f.id, { title: f.name }, userProfile?.name || ''); } catch { /* skip */ }
    }
    setSelected(new Set());
    toast('휴지통으로 이동했습니다.');
  }

  async function bulkMove(v) {
    if (!v || selected.size === 0) return;
    const folderId = v === '__root' ? null : v;
    for (const id of [...selected]) {
      try { await moveFile(id, folderId); } catch { /* skip */ }
    }
    toast(`"${folders.find((x) => x.id === folderId)?.name || '전체'}"(으)로 이동했습니다.`);
    setSelected(new Set());
  }

  const moveOptions = [
    { value: '__root', label: '전체(미분류)' },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  // ── 업로드 ──
  async function handleFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    for (const file of arr) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      try {
        await uploadFile(file, selectedFolderId, userProfile, (p) =>
          setUploads((u) => u.map((x) => x.key === key ? { ...x, progress: p } : x)),
        );
      } catch (err) {
        alert(`"${file.name}" 업로드 실패: ${err.message}`);
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
  }
  function onInputChange(e) { handleFiles(e.target.files); e.target.value = ''; }
  function onDrop(e) { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }

  // ── 폴더 생성 ──
  async function handleCreateFolder() {
    const name = folderName.trim();
    if (!name) return;
    if (folders.some((f) => f.name === name && (f.parentId || null) === selectedFolderId)) {
      alert('같은 이름의 폴더가 이미 있습니다.');
      return;
    }
    try {
      const newId = await createFolder(name, userProfile, selectedFolderId);
      setOpenMap((prev) => selectedFolderId ? { ...prev, [selectedFolderId]: true } : prev);
      setSelectedFolderId(newId);
      setFolderModalOpen(false);
      setFolderName('');
      pushUndo(`폴더 "${name}" 추가`, async () => {
        await trashGeneric('libraryFolders', newId, { title: name }, userProfile?.name || '');
      });
    } catch (err) { alert('폴더 생성 오류: ' + err.message); }
  }

  // ── 폴더 이름 변경 ──
  async function handleRename() {
    if (renameTarget?.protected && !isFolderUnlocked(renameTarget)) { alert('자동 생성된 폴더는 이름을 변경할 수 없습니다. (관리자는 자물쇠를 눌러 일시 해제)'); setRenameTarget(null); return; }
    const name = renameName.trim();
    if (!name || name === renameTarget.name) { setRenameTarget(null); return; }
    const siblings = folders.filter((f) => (f.parentId || null) === (renameTarget.parentId || null) && f.id !== renameTarget.id);
    if (siblings.some((f) => f.name === name)) { alert('같은 이름의 폴더가 이미 있습니다.'); return; }
    try {
      await renameFolder(renameTarget.id, name);
      setRenameTarget(null);
    } catch (err) { alert('이름 변경 오류: ' + err.message); }
  }

  // ── 폴더 삭제 ──
  async function handleDeleteFolder(folder, e) {
    e?.stopPropagation();
    if (folder.protected && !isFolderUnlocked(folder)) { alert('자동 생성된 폴더는 삭제할 수 없습니다. (관리자는 자물쇠를 눌러 일시 해제)'); return; }
    const filesIn = files.filter((f) => (f.folderId || null) === folder.id);
    const subsIn = folders.filter((f) => (f.parentId || null) === folder.id);
    const msg = (filesIn.length || subsIn.length)
      ? `"${folder.name}" 폴더와 안의 파일·하위폴더를 모두 휴지통으로 이동할까요?`
      : `"${folder.name}" 폴더를 휴지통으로 이동할까요?`;
    if (!(await confirm(msg))) return;
    try {
      const fileTrashIds = [];
      const subTrashIds = [];
      for (const f of filesIn) { const tid = await trashGeneric('libraryFiles', f.id, { title: f.name }, userProfile?.name || ''); if (tid) fileTrashIds.push({ tid, name: f.name }); }
      for (const s of subsIn) { const tid = await trashGeneric('libraryFolders', s.id, { title: s.name }, userProfile?.name || ''); if (tid) subTrashIds.push({ tid, name: s.name }); }
      const folderTid = await trashGeneric('libraryFolders', folder.id, { title: folder.name }, userProfile?.name || '');
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
      pushUndo(`폴더 "${folder.name}" 삭제`, async () => {
        const allIds = [folderTid, ...subTrashIds.map((x) => x.tid), ...fileTrashIds.map((x) => x.tid)].filter(Boolean);
        await Promise.all(allIds.map((tid) => restoreTrashItem(tid)));
      });
    } catch (err) { alert('폴더 삭제 오류: ' + err.message); }
  }

  // ── 파일 삭제 ──
  async function handleDeleteFile(file) {
    if (!(await confirm(`"${file.name}" 파일을 삭제할까요?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      const tid = await trashGeneric('libraryFiles', file.id, { title: file.name }, userProfile?.name || '');
      toast('휴지통으로 이동했습니다.');
      if (tid) pushUndo(`파일 "${file.name}" 삭제`, () => restoreTrashItem(tid));
    } catch (err) { alert('파일 삭제 오류: ' + err.message); }
  }

  // 드롭 영역(폴더 행)의 마우스 Y 위치 → 'before'(위 25%) | 'after'(아래 25%) | 'inside'(가운데 50%)
  function calcFolderDropMode(e, el) {
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height || 1;
    if (y < h * 0.25) return 'before';
    if (y > h * 0.75) return 'after';
    return 'inside';
  }

  // ── 폴더 드롭 핸들러 — 형제 재정렬(before/after) + 하위폴더 삽입(inside) ──
  async function handleFolderDrop(draggedId, targetId, mode) {
    const dragged = folders.find((f) => f.id === draggedId);
    const target = folders.find((f) => f.id === targetId);
    if (!dragged || !target || draggedId === targetId) return;
    if (dragged.protected && !isFolderUnlocked(dragged)) { toast('자동 생성된 폴더는 이동할 수 없습니다. (관리자는 자물쇠를 눌러 일시 해제)', 'error'); return; }
    // 순환 방지 — target이 dragged의 자손이면 이동 금지
    const isDescendant = (id) => {
      let cur = folders.find((f) => f.id === id);
      while (cur?.parentId) {
        if (cur.parentId === draggedId) return true;
        cur = folders.find((f) => f.id === cur.parentId);
      }
      return false;
    };
    if (isDescendant(targetId)) return;

    if (mode === 'inside') {
      // target의 하위폴더로 삽입 — 기존 자식들 뒤(맨 끝 순서)에 배치
      if ((dragged.parentId || null) === target.id) return; // 이미 그 폴더의 자식
      const childSiblings = folders
        .filter((f) => (f.parentId || null) === target.id && f.id !== draggedId)
        .sort(sortFolders);
      const orderUpdates = [...childSiblings, dragged].map((f, i) => ({ id: f.id, order: i }));
      try {
        await moveFolder(draggedId, target.id);
        await setFolderOrder(orderUpdates);
        setOpenMap((prev) => ({ ...prev, [target.id]: true })); // 받은 폴더 자동 펼침
        toast(`"${target.name}" 하위로 이동했습니다.`);
      } catch (err) { toast(err?.message || '이동에 실패했습니다.', 'error'); }
      return;
    }

    // before/after — target과 같은 레벨(형제)로 재정렬
    const targetParent = target.parentId || null;
    const siblings = folders
      .filter((f) => (f.parentId || null) === targetParent && f.id !== draggedId)
      .sort(sortFolders);
    const targetIdx = siblings.findIndex((f) => f.id === targetId);
    const insertIdx = mode === 'before' ? targetIdx : targetIdx + 1;
    siblings.splice(insertIdx, 0, dragged);
    const orderUpdates = siblings.map((f, i) => ({ id: f.id, order: i }));

    try {
      if ((dragged.parentId || null) !== targetParent) await moveFolder(draggedId, targetParent);
      await setFolderOrder(orderUpdates);
    } catch (err) { toast(err?.message || '이동에 실패했습니다.', 'error'); }
  }

  // ── 파일·폴더 트리 DnD ──
  function treeDndProps(folder) {
    return {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.setData('text/folderid', folder.id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingFolderId(folder.id);
      },
      onDragEnd: () => {
        setDraggingFolderId(null);
        setFolderDragOverId(undefined);
        setDragOverId(undefined);
      },
      onDragOver: (e) => {
        const hasFile = e.dataTransfer.types.includes('text/fileid');
        const hasFolder = e.dataTransfer.types.includes('text/folderid');
        if (!hasFile && !hasFolder) return;
        e.preventDefault();
        if (hasFile) {
          if ((folder.parentId || null) === null) return; // 대분류엔 파일 드롭 금지
          e.dataTransfer.dropEffect = 'move';
          setDragOverId(folder.id);
          return;
        }
        if (hasFolder && folder.id !== draggingFolderId) {
          e.dataTransfer.dropEffect = 'move';
          setFolderDragOverId(folder.id);
          setFolderDropMode(calcFolderDropMode(e, e.currentTarget));
        }
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragOverId((cur) => cur === folder.id ? undefined : cur);
        setFolderDragOverId((cur) => cur === folder.id ? undefined : cur);
      },
      onDrop: async (e) => {
        e.preventDefault();
        const fileId = e.dataTransfer.getData('text/fileId');
        const foldId = e.dataTransfer.getData('text/folderid');
        const mode = calcFolderDropMode(e, e.currentTarget);
        setDragOverId(undefined);
        setFolderDragOverId(undefined);
        setDraggingFolderId(null);
        setDraggingFileId(null);
        if (fileId) {
          const f = files.find((x) => x.id === fileId);
          if (!f || (f.folderId || null) === folder.id) return;
          try {
            await moveFile(fileId, folder.id);
            toast(`"${folder.name}"(으)로 이동했습니다.`);
          } catch (err) { toast(err?.message || '이동에 실패했습니다.', 'error'); }
          return;
        }
        if (foldId && foldId !== folder.id) {
          await handleFolderDrop(foldId, folder.id, mode);
        }
      },
    };
  }

  const selectedFolderName = selectedFolderId === null
    ? '전체'
    : (folders.find((f) => f.id === selectedFolderId)?.name || '폴더');

  if (!canViewArchive) {
    return (
      <div className="library-page">
        <div className="page-header"><h2>자료실</h2></div>
        <p className="purchase-empty">자료실 열람 권한이 없습니다. 관리자에게 문의하세요.</p>
      </div>
    );
  }

  return (
    <div className="library-page">
      {/* 헤더 */}
      <div className="page-header">
        <h2>자료실</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />휴지통
            {trashCount > 0 && <span className="trash-count-badge">{trashCount}</span>}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>
            <Icon name="plus" className="btn-ic" />파일 올리기
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={onInputChange} />

      {/* 업로드 진행률 */}
      {uploads.length > 0 && (
        <div className="library-uploads">
          {uploads.map((u) => (
            <div key={u.key} className="library-upload-row">
              <span className="library-upload-name">{u.name}</span>
              <div className="library-upload-bar"><div className="library-upload-fill" style={{ width: `${u.progress}%` }} /></div>
              <span className="library-upload-pct">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {/* 메인 레이아웃 — 사이드바 없이 경로(브레드크럼)로 탐색 */}
      <div className="lib-layout">

        {/* 파일/폴더 영역 */}
        <div className="lib-content">

          {/* 경로(주소 표시줄) + 뒤로가기 — 모바일 드릴다운 네비 */}
          <div className="lib-breadcrumb">
            <button
              type="button"
              className="lib-bc-back"
              onClick={() => selectFolder(selectedFolder?.parentId || null)}
              disabled={selectedFolderId === null}
              aria-label="상위 폴더로"
              title="상위 폴더로"
            >
              <Icon name="chevronRight" className="lib-bc-back-ic" />
            </button>
            <div className="lib-bc-trail">
              <button
                type="button"
                className={`lib-bc-item${selectedFolderId === null ? ' is-current' : ''}`}
                onClick={() => selectFolder(null)}
              >
                <Icon name="folder" className="lib-bc-home-ic" /> 전체
              </button>
              {breadcrumb.map((f) => (
                <span key={f.id} className="lib-bc-entry">
                  <span className="lib-bc-sep">›</span>
                  <button
                    type="button"
                    className={`lib-bc-item${f.id === selectedFolderId ? ' is-current' : ''}`}
                    onClick={() => selectFolder(f.id)}
                  >
                    {f.name}
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* 툴바 */}
          <div className="lib-toolbar">
            {selected.size > 0 ? (
              <>
                <span className="lib-sel-count">{selected.size}개 선택</span>
                <div className="lib-bulk">
                  <Select value="" onChange={bulkMove} options={moveOptions} placeholder="이동" ariaLabel="폴더로 이동" />
                  <button type="button" className="btn btn-sm btn-danger" onClick={bulkDelete}>
                    <Icon name="trash" className="btn-ic" />삭제
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setSelected(new Set())}>해제</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="library-main-title">{selectedFolderName}</h3>
                <span className="library-main-count">{currentSubFolders.length + currentFiles.length}개 항목</span>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setFolderModalOpen(true)}>
                  <Icon name="plus" className="btn-ic" />새 폴더
                </button>
                <div className="lib-search-inline">
                  <input
                    type="search"
                    placeholder="이 폴더에서 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="파일 검색"
                  />
                </div>
              </>
            )}
          </div>

          {/* 탐색기 상세 보기: 폴더 + 파일 한 표 */}
          <div
            className={`library-dropzone${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {currentSubFolders.length === 0 && currentFiles.length === 0 ? (
              <div className="library-empty">
                <div className="library-empty-art"><Icon name={search.trim() ? 'search' : 'folder'} /></div>
                {search.trim() ? (
                  <>
                    <p className="library-empty-title">검색 결과가 없습니다</p>
                    <p className="library-empty-sub">다른 검색어로 다시 시도해 보세요.</p>
                  </>
                ) : (
                  <>
                    <p className="library-empty-title">이 폴더가 비어 있습니다</p>
                    <p className="library-empty-sub">파일을 끌어다 놓거나 버튼으로 올리세요.</p>
                    <button type="button" className="btn btn-primary btn-sm library-empty-cta" onClick={() => fileInputRef.current?.click()}>
                      <Icon name="plus" className="btn-ic" />파일 올리기
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="table-scroll-x">
                <table className="table lib-detail-table">
                  <thead>
                    <tr>
                      <th className="lib-col-check">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          disabled={currentFiles.length === 0}
                          aria-label="전체 선택"
                        />
                      </th>
                      <th className="lib-col-name">이름</th>
                      <th className="lib-col-type">종류</th>
                      <th className="lib-col-date">수정일</th>
                      <th className="lib-col-size">크기</th>
                      <th className="col-action">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* 폴더 행 */}
                    {currentSubFolders.map((folder) => {
                      const stats = getFolderStats(folder.id, folders, files);
                      const cnt = stats.fileCount;
                      const subCnt = stats.folderCount;
                      const isFileTarget = dragOverId === folder.id;
                      const isFolderOver = folderDragOverId === folder.id && draggingFolderId !== folder.id;
                      const dropCls = isFolderOver
                        ? folderDropMode === 'inside'
                          ? ' drag-folder-inside'
                          : folderDropMode === 'before'
                            ? ' drag-folder-before'
                            : ' drag-folder-after'
                        : '';
                      return (
                        <tr
                          key={folder.id}
                          className={`lib-row lib-row--folder${isFileTarget ? ' drag-over' : ''}${dropCls}`}
                          onClick={() => selectFolder(folder.id)}
                          {...treeDndProps(folder)}
                        >
                          <td className="lib-col-check" onClick={(e) => e.stopPropagation()}></td>
                          <td className="lib-col-name" data-label="이름" title={folder.name}>
                            <span className="lib-row-ic"><Icon name="folder" /></span>
                            <span className="lib-row-name">{folder.name}</span>
                          </td>
                          <td className="lib-col-type" data-label="종류">폴더</td>
                          <td className="lib-col-date" data-label="수정일">{stats.latest ? formatDate(stats.latest) : '—'}</td>
                          <td className="lib-col-size" data-label="크기">
                            {subCnt > 0 ? `${subCnt}개 폴더 · ` : ''}{cnt}개 파일
                          </td>
                          <td className="col-action" onClick={(e) => e.stopPropagation()}>
                            {folder.protected && !isFolderUnlocked(folder) ? (
                              isAdmin ? (
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline lib-lock-btn"
                                    title="관리자 — 클릭하면 잠금을 일시 해제합니다 (수정·삭제 가능)"
                                    aria-label="잠금 해제"
                                    onClick={(e) => toggleFolderLock(folder, e)}
                                  >
                                    <Icon name="lock" className="btn-ic" />잠금
                                  </button>
                                </div>
                              ) : (
                                <span className="lib-locked-label" title="자동 생성 폴더 (수정·삭제 불가)">
                                  <Icon name="lock" className="btn-ic" />자동
                                </span>
                              )
                            ) : (
                              <div className="row-actions">
                                {folder.protected && isAdmin && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline lib-relock-btn"
                                    title="다시 잠그기"
                                    aria-label="다시 잠그기"
                                    onClick={(e) => toggleFolderLock(folder, e)}
                                  >
                                    <Icon name="unlock" className="btn-ic" />해제됨
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  title="이름 변경"
                                  aria-label="이름 변경"
                                  onClick={() => { setRenameTarget(folder); setRenameName(folder.name); }}
                                >
                                  <Icon name="edit" className="btn-ic" />수정
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  title="삭제"
                                  aria-label="삭제"
                                  onClick={(e) => handleDeleteFolder(folder, e)}
                                >
                                  <Icon name="trash" className="btn-ic" />삭제
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {/* 파일 행 */}
                    {currentFiles.map((file) => {
                      const ext = (file.name.split('.').pop() || '').toUpperCase();
                      return (
                        <tr
                          key={file.id}
                          className={`lib-row lib-row--file${selected.has(file.id) ? ' is-selected' : ''}${draggingFileId === file.id ? ' is-dragging' : ''}`}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/fileId', file.id);
                            e.dataTransfer.effectAllowed = 'move';
                            setDraggingFileId(file.id);
                          }}
                          onDragEnd={() => { setDraggingFileId(null); setDragOverId(undefined); }}
                        >
                          <td className="lib-col-check" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(file.id)} onChange={(e) => toggleSelect(file.id, e)} aria-label="파일 선택" />
                          </td>
                          <td className="lib-col-name" data-label="이름" title={file.name}>
                            <span className="lib-row-ic"><Icon name={getFileIconName(file.name, file.contentType)} /></span>
                            <a className="lib-row-name" href={file.downloadURL} target="_blank" rel="noopener noreferrer">
                              {file.name}
                            </a>
                          </td>
                          <td className="lib-col-type" data-label="종류">{ext || '파일'}</td>
                          <td className="lib-col-date" data-label="수정일">{formatDate(file.createdAt)}</td>
                          <td className="lib-col-size" data-label="크기">{formatSize(file.size)}</td>
                          <td className="col-action" onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              <a className="library-file-btn download" href={file.downloadURL} target="_blank" rel="noopener noreferrer" title="다운로드" aria-label="다운로드">
                                <Icon name="download" />
                              </a>
                              <button type="button" className="btn btn-sm btn-danger" title="삭제" aria-label="삭제" onClick={() => handleDeleteFile(file)}>
                                <Icon name="trash" className="btn-ic" />삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 폴더 추가 모달 */}
      <Modal isOpen={folderModalOpen} onClose={() => setFolderModalOpen(false)} title={selectedFolderId ? '하위 폴더 추가' : '대분류 추가'}>
        <div className="form-group">
          <label>폴더 이름</label>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && folderName.trim()) handleCreateFolder(); }}
            placeholder={selectedFolderId ? '예: 양식, 규정, 교육자료' : '예: 인사자료, 현장자료, 계약서'}
            autoFocus
          />
          {selectedFolderId && (
            <p className="form-hint">
              "{folders.find((f) => f.id === selectedFolderId)?.name}" 안에 추가됩니다.
            </p>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setFolderModalOpen(false)}>취소</button>
          <button type="button" className="btn btn-primary" disabled={!folderName.trim()} onClick={handleCreateFolder}>추가</button>
        </div>
      </Modal>

      {/* 폴더 이름 변경 모달 */}
      <Modal isOpen={!!renameTarget} onClose={() => setRenameTarget(null)} title="폴더 이름 변경">
        <div className="form-group">
          <label>새 이름</label>
          <input
            type="text"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && renameName.trim()) handleRename(); }}
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setRenameTarget(null)}>취소</button>
          <button type="button" className="btn btn-primary" disabled={!renameName.trim()} onClick={handleRename}>저장</button>
        </div>
      </Modal>

      <TrashModal isOpen={trashOpen} onClose={() => setTrashOpen(false)} types={['libraryFiles', 'libraryFolders']} title="자료실 휴지통" />
    </div>
  );
}
