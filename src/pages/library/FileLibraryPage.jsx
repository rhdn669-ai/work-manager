import { useState, useEffect, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';
import {
  subscribeFolders, subscribeFiles, createFolder, deleteFolder, uploadFile, deleteFile,
} from '../../services/fileLibraryService';

// 파일 용량 표시
function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// 업로드 날짜 표시
function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

// 확장자별 아이콘 이모지
function fileIcon(name = '', contentType = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (contentType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic'].includes(ext)) return '🖼️';
  if (contentType.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return '🎬';
  if (contentType.startsWith('audio/') || ['mp3', 'wav', 'm4a'].includes(ext)) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['hwp', 'hwpx'].includes(ext)) return '📄';
  if (['dwg', 'dxf'].includes(ext)) return '📐';
  if (['txt', 'md'].includes(ext)) return '📝';
  return '📎';
}

export default function FileLibraryPage() {
  const { userProfile } = useAuth();
  const { confirm, alert } = useDialog();

  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null); // null = 전체
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  // 모바일: 폴더 목록 ↔ 파일 목록 전환 (true면 파일 목록 표시)
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false);

  // 폴더 추가 모달
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [folderName, setFolderName] = useState('');

  // 업로드 진행 상태 { name, progress }[]
  const [uploads, setUploads] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const unsubF = subscribeFolders(setFolders);
    const unsubFiles = subscribeFiles(setFiles);
    return () => { unsubF(); unsubFiles(); };
  }, []);

  // 현재 폴더 + 검색어로 필터링한 파일
  const visibleFiles = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return files.filter((f) => {
      if (activeFolder !== null && (f.folderId || null) !== activeFolder) return false;
      if (kw && !(f.name || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [files, activeFolder, search]);

  // 폴더별 파일 개수
  const countFor = (folderId) => files.filter((f) => (f.folderId || null) === folderId).length;

  // 현재 선택된 폴더 이름 (헤더 표시용)
  const activeFolderName = activeFolder === null
    ? '전체'
    : (folders.find((f) => f.id === activeFolder)?.name || '폴더');

  function selectFolder(id) {
    setActiveFolder(id);
    setMobileFilesOpen(true); // 모바일에서 파일 목록으로 전환
  }

  async function handleFiles(fileList) {
    const arr = Array.from(fileList || []);
    if (arr.length === 0) return;
    for (const file of arr) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: file.name, progress: 0 }]);
      try {
        await uploadFile(file, activeFolder, userProfile, (p) => {
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x)));
        });
      } catch (err) {
        alert(`"${file.name}" 업로드 실패: ${err.message}`);
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
  }

  function onInputChange(e) {
    handleFiles(e.target.files);
    e.target.value = ''; // 같은 파일 재선택 가능하도록 초기화
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleCreateFolder() {
    const name = folderName.trim();
    if (!name) return;
    if (folders.some((f) => f.name === name)) {
      alert('같은 이름의 폴더가 이미 있습니다.');
      return;
    }
    try {
      await createFolder(name, userProfile);
      setFolderModalOpen(false);
      setFolderName('');
    } catch (err) {
      alert('폴더 생성 오류: ' + err.message);
    }
  }

  async function handleDeleteFolder(folder, e) {
    if (e) e.stopPropagation();
    const n = countFor(folder.id);
    const msg = n > 0
      ? `"${folder.name}" 폴더와 그 안의 파일 ${n}개가 모두 삭제됩니다. 계속할까요?`
      : `"${folder.name}" 폴더를 삭제할까요?`;
    if (!await confirm(msg)) return;
    try {
      await deleteFolder(folder.id);
      if (activeFolder === folder.id) { setActiveFolder(null); setMobileFilesOpen(false); }
    } catch (err) {
      alert('폴더 삭제 오류: ' + err.message);
    }
  }

  async function handleDeleteFile(file) {
    if (!await confirm(`"${file.name}" 파일을 삭제할까요?`)) return;
    try {
      await deleteFile(file);
    } catch (err) {
      alert('파일 삭제 오류: ' + err.message);
    }
  }

  return (
    <div className="library-page">
      <div className="page-header">
        <h2>자료실</h2>
        <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()}>파일 올리기</button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onInputChange}
      />

      {/* 업로드 진행률 */}
      {uploads.length > 0 && (
        <div className="library-uploads">
          {uploads.map((u) => (
            <div key={u.key} className="library-upload-row">
              <span className="library-upload-name">{u.name}</span>
              <div className="library-upload-bar">
                <div className="library-upload-fill" style={{ width: `${u.progress}%` }} />
              </div>
              <span className="library-upload-pct">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      <div className={`library-layout ${mobileFilesOpen ? 'mobile-files-open' : ''}`}>
        {/* 왼쪽: 폴더 리스트 */}
        <aside className="library-sidebar">
          <div className="library-sidebar-head">
            <span>폴더</span>
            <div className="library-sidebar-head-actions">
              {folders.length > 0 && (
                <button
                  className={`library-edit-toggle ${editMode ? 'active' : ''}`}
                  onClick={() => setEditMode((v) => !v)}
                >{editMode ? '완료' : '편집'}</button>
              )}
            </div>
          </div>

          <ul className="library-folder-list">
            <li
              className={`library-folder-item ${activeFolder === null ? 'active' : ''}`}
              onClick={() => selectFolder(null)}
            >
              <span className="lf-icon">🗂️</span>
              <span className="lf-name">전체</span>
              <span className="lf-count">{files.length}</span>
            </li>
            {folders.map((f) => (
              <li
                key={f.id}
                className={`library-folder-item ${activeFolder === f.id ? 'active' : ''}`}
                onClick={() => selectFolder(f.id)}
              >
                <span className="lf-icon">📁</span>
                <span className="lf-name">{f.name}</span>
                {editMode ? (
                  <button
                    className="lf-del"
                    title="폴더 삭제"
                    onClick={(e) => handleDeleteFolder(f, e)}
                  >✕</button>
                ) : (
                  <span className="lf-count">{countFor(f.id)}</span>
                )}
              </li>
            ))}
          </ul>

          <button className="library-add-folder" onClick={() => setFolderModalOpen(true)}>+ 폴더 추가</button>
        </aside>

        {/* 오른쪽: 파일 목록 */}
        <section className="library-main">
          <div className="library-main-head">
            <button className="library-back-btn" onClick={() => setMobileFilesOpen(false)} aria-label="폴더 목록으로">‹ 폴더</button>
            <h3 className="library-main-title">{activeFolderName}</h3>
            <span className="library-main-count">{visibleFiles.length}개</span>
          </div>

          <div className="library-search">
            <input
              type="search"
              placeholder="파일 이름 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div
            className={`library-dropzone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {visibleFiles.length === 0 ? (
              <div className="library-empty">
                {search.trim()
                  ? '검색 결과가 없습니다.'
                  : '이 폴더에 파일이 없습니다.\n파일을 끌어다 놓거나 "파일 올리기"를 누르세요.'}
              </div>
            ) : (
              <div className="library-file-list">
                {visibleFiles.map((file) => (
                  <div key={file.id} className="library-file-card">
                    <span className="library-file-icon">{fileIcon(file.name, file.contentType)}</span>
                    <div className="library-file-info">
                      <a
                        className="library-file-name"
                        href={file.downloadURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={file.name}
                      >{file.name}</a>
                      <div className="library-file-meta">
                        <span>{formatSize(file.size)}</span>
                        <span className="dot">·</span>
                        <span>{file.uploadedByName || '알수없음'}</span>
                        <span className="dot">·</span>
                        <span>{formatDate(file.createdAt)}</span>
                      </div>
                    </div>
                    <div className="library-file-actions">
                      <a
                        className="library-file-btn download"
                        href={file.downloadURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="다운로드"
                      >⤓</a>
                      <button
                        className="library-file-btn delete"
                        title="삭제"
                        onClick={() => handleDeleteFile(file)}
                      >✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 폴더 추가 모달 */}
      <Modal isOpen={folderModalOpen} onClose={() => setFolderModalOpen(false)} title="폴더 추가">
        <div className="form-group">
          <label>폴더 이름</label>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && folderName.trim()) handleCreateFolder(); }}
            placeholder="예: 공지, 양식, 교육자료"
            autoFocus
            maxLength={30}
          />
          <p className="field-hint" style={{ marginTop: 6 }}>
            모든 직원이 함께 사용하는 폴더입니다.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={!folderName.trim()} onClick={handleCreateFolder}>추가</button>
          <button type="button" className="btn btn-outline" onClick={() => setFolderModalOpen(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
