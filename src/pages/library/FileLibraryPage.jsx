import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/DialogProvider';
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
import { trashGeneric } from '../../services/trashService';
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
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function fileIcon(name = '', contentType = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (contentType.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','bmp','heic'].includes(ext)) return '🖼️';
  if (contentType.startsWith('video/') || ['mp4','mov','avi','mkv','webm'].includes(ext)) return '🎬';
  if (contentType.startsWith('audio/') || ['mp3','wav','m4a'].includes(ext)) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['doc','docx'].includes(ext)) return '📘';
  if (['xls','xlsx','csv'].includes(ext)) return '📗';
  if (['ppt','pptx'].includes(ext)) return '📙';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  if (['hwp','hwpx'].includes(ext)) return '📄';
  if (['dwg','dxf'].includes(ext)) return '📐';
  if (['txt','md'].includes(ext)) return '📝';
  return '📎';
}

// 폴더 ID → 조상 ID 목록
function getAncestorIds(folderId, folders) {
  const map = Object.fromEntries(folders.map((f) => [f.id, f]));
  const result = [];
  let cur = map[folderId];
  while (cur?.parentId) { result.push(cur.parentId); cur = map[cur.parentId]; }
  return result;
}

// ── 트리 노드 ──
function TreeNode({ folder, folders, files, selectedId, onSelect, onRename, onDelete, dragOverId, dndProps, depth, openMap, toggleOpen, folderDragOverId, folderDragBefore, draggingFolderId }) {
  const children = useMemo(
    () => folders.filter((f) => (f.parentId || null) === folder.id).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)),
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
        className={`lib-tree-row${isActive ? ' is-active' : ''}${isDragOver ? ' drag-over' : ''}${isFolderTarget && folderDragBefore ? ' drag-folder-before' : ''}${isFolderTarget && !folderDragBefore ? ' drag-folder-after' : ''}`}
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
        <span className="lib-tree-ic">📁</span>
        <span className="lib-tree-name">{folder.name}</span>
        {fileCount > 0 && <span className="lib-tree-badge">{fileCount}</span>}
        {/* hover 시 노출되는 액션 버튼 */}
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
          folderDragBefore={folderDragBefore}
          draggingFolderId={draggingFolderId}
        />
      ))}
    </>
  );
}

export default function FileLibraryPage() {
  const { userProfile, canViewArchive } = useAuth();
  const { confirm, alert, toast } = useDialog();

  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(null); // null = 전체
  const [openMap, setOpenMap] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false); // 모바일용

  const [draggingFileId, setDraggingFileId] = useState(null);
  const [dragOverId, setDragOverId] = useState(undefined);
  const [draggingFolderId, setDraggingFolderId] = useState(null);
  const [folderDragOverId, setFolderDragOverId] = useState(undefined);
  const [folderDragBefore, setFolderDragBefore] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());

  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState('');

  const [uploads, setUploads] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsubF = subscribeFolders(setFolders);
    const unsubFiles = subscribeFiles(setFiles);
    return () => { unsubF(); unsubFiles(); };
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
    () => folders.filter((f) => (f.parentId || null) === null).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9)),
    [folders],
  );

  // 선택한 폴더가 대분류(최상위)인지 여부
  const selectedFolder = selectedFolderId !== null ? folders.find((f) => f.id === selectedFolderId) : null;
  const isTopLevel = !!selectedFolder && (selectedFolder.parentId || null) === null;

  const subFolders = useMemo(
    () => isTopLevel
      ? folders.filter((f) => (f.parentId || null) === selectedFolderId).sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9))
      : [],
    [isTopLevel, folders, selectedFolderId],
  );

  // 파일 목록: 전체(null)면 모든 파일, 폴더 선택 시 해당 폴더 파일
  const visibleFiles = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const base = selectedFolderId === null
      ? files
      : files.filter((f) => (f.folderId || null) === selectedFolderId);
    if (kw) return base.filter((f) => (f.name || '').toLowerCase().includes(kw));
    return base;
  }, [files, selectedFolderId, search]);

  function selectFolder(id) {
    setSelectedFolderId(id);
    setSearch('');
    setSelected(new Set());
    setSidebarOpen(false);
  }

  function toggleOpen(id) {
    setOpenMap((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  // ── 다중 선택 ──
  const allSelected = visibleFiles.length > 0 && visibleFiles.every((f) => selected.has(f.id));
  function toggleSelect(id, e) {
    e?.stopPropagation();
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(() => allSelected ? new Set() : new Set(visibleFiles.map((f) => f.id)));
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
    if (isTopLevel) { toast('파일은 하위 폴더에 넣어주세요.', 'error'); return; }
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
    } catch (err) { alert('폴더 생성 오류: ' + err.message); }
  }

  // ── 폴더 이름 변경 ──
  async function handleRename() {
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
    const filesIn = files.filter((f) => (f.folderId || null) === folder.id);
    const subsIn = folders.filter((f) => (f.parentId || null) === folder.id);
    const msg = (filesIn.length || subsIn.length)
      ? `"${folder.name}" 폴더와 안의 파일·하위폴더를 모두 휴지통으로 이동할까요?`
      : `"${folder.name}" 폴더를 휴지통으로 이동할까요?`;
    if (!(await confirm(msg))) return;
    try {
      for (const f of filesIn) await trashGeneric('libraryFiles', f.id, { title: f.name }, userProfile?.name || '');
      for (const s of subsIn) await trashGeneric('libraryFolders', s.id, { title: s.name }, userProfile?.name || '');
      await trashGeneric('libraryFolders', folder.id, { title: folder.name }, userProfile?.name || '');
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
    } catch (err) { alert('폴더 삭제 오류: ' + err.message); }
  }

  // ── 파일 삭제 ──
  async function handleDeleteFile(file) {
    if (!(await confirm(`"${file.name}" 파일을 삭제할까요?\n휴지통에서 복원할 수 있습니다.`))) return;
    try {
      await trashGeneric('libraryFiles', file.id, { title: file.name }, userProfile?.name || '');
      toast('휴지통으로 이동했습니다.');
    } catch (err) { alert('파일 삭제 오류: ' + err.message); }
  }

  // ── 폴더 재정렬 드롭 핸들러 ──
  async function handleFolderDrop(draggedId, targetId, insertBefore) {
    const dragged = folders.find((f) => f.id === draggedId);
    const target = folders.find((f) => f.id === targetId);
    if (!dragged || !target || draggedId === targetId) return;
    // 순환 방지
    const isDescendant = (id) => {
      let cur = folders.find((f) => f.id === id);
      while (cur?.parentId) {
        if (cur.parentId === draggedId) return true;
        cur = folders.find((f) => f.id === cur.parentId);
      }
      return false;
    };
    if (isDescendant(targetId)) return;

    const targetParent = target.parentId || null;
    const siblings = folders
      .filter((f) => (f.parentId || null) === targetParent && f.id !== draggedId)
      .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
    const targetIdx = siblings.findIndex((f) => f.id === targetId);
    const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
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
          const rect = e.currentTarget.getBoundingClientRect();
          const isBefore = e.clientY < rect.top + rect.height / 2;
          setFolderDragOverId(folder.id);
          setFolderDragBefore(isBefore);
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
        const rect = e.currentTarget.getBoundingClientRect();
        const isBefore = e.clientY < rect.top + rect.height / 2;
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
          await handleFolderDrop(foldId, folder.id, isBefore);
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

      {/* 모바일 사이드바 토글 */}
      <button type="button" className="lib-sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}>
        <Icon name="folder" className="btn-ic" />
        {selectedFolderName}
        <Icon name="chevronDown" className="btn-ic" style={{ marginLeft: 'auto' }} />
      </button>

      {/* 메인 레이아웃 */}
      <div className="lib-layout">

        {/* 좌측 트리 */}
        <aside className={`lib-sidebar${sidebarOpen ? ' is-open' : ''}`}>
          <div className="lib-sidebar-head">
            <span className="lib-sidebar-title">폴더</span>
            <button
              type="button"
              className="lib-sidebar-add"
              title="폴더 추가"
              onClick={() => setFolderModalOpen(true)}
            >
              <Icon name="plus" />
            </button>
          </div>

          <div className="lib-tree">
            {/* 전체 */}
            <div
              role="button"
              tabIndex={0}
              className={`lib-tree-row${selectedFolderId === null ? ' is-active' : ''}`}
              style={{ paddingLeft: 10 }}
              onClick={() => selectFolder(null)}
              onKeyDown={(e) => e.key === 'Enter' && selectFolder(null)}
            >
              <span className="lib-tree-caret" style={{ visibility: 'hidden' }} />
              <span className="lib-tree-ic">📦</span>
              <span className="lib-tree-name">전체</span>
              <span className="lib-tree-badge">{files.length || ''}</span>
            </div>

            {/* 폴더 트리 */}
            {topFolders.map((f) => (
              <TreeNode
                key={f.id}
                folder={f}
                folders={folders}
                files={files}
                selectedId={selectedFolderId}
                onSelect={selectFolder}
                onRename={(folder) => { setRenameTarget(folder); setRenameName(folder.name); }}
                onDelete={handleDeleteFolder}
                dragOverId={dragOverId}
                dndProps={treeDndProps}
                depth={0}
                openMap={openMap}
                toggleOpen={toggleOpen}
                folderDragOverId={folderDragOverId}
                folderDragBefore={folderDragBefore}
                draggingFolderId={draggingFolderId}
              />
            ))}
          </div>
        </aside>

        {/* 우측 파일 영역 */}
        <div className="lib-content">

          {isTopLevel ? (
            /* ── 대분류 선택: 하위 폴더 그리드 ── */
            <>
              <div className="lib-toolbar">
                <h3 className="library-main-title">{selectedFolderName}</h3>
                <span className="library-main-count">{subFolders.length}개 폴더</span>
              </div>
              <div className="lib-subfolder-grid">
                {subFolders.map((sf) => {
                  const cnt = files.filter((f) => (f.folderId || null) === sf.id).length;
                  return (
                    <button
                      key={sf.id}
                      type="button"
                      className="lib-subfolder-card"
                      onClick={() => selectFolder(sf.id)}
                    >
                      <span className="lib-subfolder-card__icon">📁</span>
                      <span className="lib-subfolder-card__name">{sf.name}</span>
                      <span className="lib-subfolder-card__count">{cnt}개 파일</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="lib-subfolder-card lib-subfolder-card--add"
                  onClick={() => setFolderModalOpen(true)}
                >
                  <span className="lib-subfolder-card__icon"><Icon name="plus" /></span>
                  <span className="lib-subfolder-card__name">폴더 추가</span>
                </button>
              </div>
            </>
          ) : (
            /* ── 전체 / 하위 폴더 선택: 파일 목록 ── */
            <>
              <div className="lib-toolbar">
                <label className="lib-check" title="전체 선택">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    disabled={visibleFiles.length === 0}
                    aria-label="전체 선택"
                  />
                </label>
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
                    <span className="library-main-count">{visibleFiles.length}개</span>
                    <div className="lib-search-inline">
                      <input
                        type="search"
                        placeholder="파일 검색"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label="파일 검색"
                      />
                    </div>
                  </>
                )}
              </div>

              <div
                className={`library-dropzone${dragOver ? ' drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                {visibleFiles.length === 0 ? (
                  <div className="library-empty">
                    <div className="library-empty-art"><Icon name={search.trim() ? 'search' : 'folder'} /></div>
                    {search.trim() ? (
                      <>
                        <p className="library-empty-title">검색 결과가 없습니다</p>
                        <p className="library-empty-sub">다른 검색어로 다시 시도해 보세요.</p>
                      </>
                    ) : (
                      <>
                        <p className="library-empty-title">파일이 없습니다</p>
                        <p className="library-empty-sub">파일을 끌어다 놓거나 버튼으로 올리세요.</p>
                        <button type="button" className="btn btn-primary btn-sm library-empty-cta" onClick={() => fileInputRef.current?.click()}>
                          <Icon name="plus" className="btn-ic" />파일 올리기
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="library-file-list">
                    {visibleFiles.map((file) => (
                      <div
                        key={file.id}
                        className={`library-file-card${draggingFileId === file.id ? ' is-dragging' : ''}${selected.has(file.id) ? ' is-selected' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/fileId', file.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDraggingFileId(file.id);
                        }}
                        onDragEnd={() => { setDraggingFileId(null); setDragOverId(undefined); }}
                      >
                        <label className="lib-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(file.id)} onChange={(e) => toggleSelect(file.id, e)} aria-label="파일 선택" />
                        </label>
                        <span className="library-file-icon">{fileIcon(file.name, file.contentType)}</span>
                        <div className="library-file-info">
                          <a className="library-file-name" href={file.downloadURL} target="_blank" rel="noopener noreferrer" title={file.name}>
                            {file.name}
                          </a>
                          <div className="library-file-meta">
                            <span>{formatSize(file.size)}</span>
                            <span className="dot">·</span>
                            <span>{file.uploadedByName || '알수없음'}</span>
                          </div>
                        </div>
                        <span className="library-file-date">{formatDate(file.createdAt)}</span>
                        <div className="library-file-actions">
                          <a className="library-file-btn download" href={file.downloadURL} target="_blank" rel="noopener noreferrer" title="다운로드">
                            <Icon name="download" />
                          </a>
                          <button type="button" className="library-file-btn delete" title="삭제" aria-label="삭제" onClick={() => handleDeleteFile(file)}>
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
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
            maxLength={30}
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
            maxLength={30}
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
