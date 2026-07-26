import { useState, useCallback, useRef } from 'react';
import { UploadContext } from './useUploads';
import { uploadFile } from '../services/fileLibraryService';
import { useDialog } from '../components/common/useDialog';

// 전역 업로드 관리 — 자료실뿐 아니라 어느 화면으로 이동해도 진행률이 유지되도록
// 업로드 상태를 앱 최상위(라우터 밖)에 둔다. 페이지가 언마운트돼도 업로드는 계속 진행되고,
// 진행률은 항상 떠 있는 UploadDock에 표시된다. (CLAUDE.md 저장·업로드 백그라운드 원칙)
export function UploadProvider({ children }) {
  const { toast } = useDialog();
  // uploads: [{ key, name, progress, status:'uploading'|'done'|'error', folderName }]
  const [uploads, setUploads] = useState([]);
  const idRef = useRef(0);
  // 한 배치가 모두 끝나면 결과 토스트를 1회만 띄우기 위한 카운터
  const statsRef = useRef({ pending: 0, done: 0, error: 0 });

  const settle = useCallback(() => {
    const s = statsRef.current;
    s.pending -= 1;
    if (s.pending <= 0) {
      s.pending = 0;
      const { done, error } = s;
      if (done > 0 || error > 0) {
        const msg = error > 0 ? `${done}개 업로드 완료 · ${error}개 실패` : `${done}개 파일 업로드 완료`;
        toast(msg, error > 0 ? 'error' : 'success', 0); // sticky
      }
    }
  }, [toast]);

  const startUploads = useCallback(
    (fileList, folderId, folderName, user) => {
      const arr = Array.from(fileList || []);
      if (!arr.length) return;
      // 유휴 상태에서 새 배치 시작이면 결과 카운터 초기화
      if (statsRef.current.pending === 0) statsRef.current = { pending: 0, done: 0, error: 0 };
      statsRef.current.pending += arr.length;

      arr.forEach((file) => {
        const key = `u${(idRef.current += 1)}`;
        setUploads((u) => [
          ...u,
          { key, name: file.name, progress: 0, status: 'uploading', folderName: folderName || '전체' },
        ]);
        uploadFile(file, folderId, user, (p) =>
          setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: p } : x))),
        )
          .then(() => {
            statsRef.current.done += 1;
            setUploads((u) => u.map((x) => (x.key === key ? { ...x, progress: 100, status: 'done' } : x)));
            // 완료 행은 잠시 후 자동 정리
            setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 4000);
            settle();
          })
          .catch(() => {
            statsRef.current.error += 1;
            setUploads((u) => u.map((x) => (x.key === key ? { ...x, status: 'error' } : x)));
            settle();
          });
      });
    },
    [settle],
  );

  const dismiss = useCallback((key) => setUploads((u) => u.filter((x) => x.key !== key)), []);

  return <UploadContext.Provider value={{ uploads, startUploads, dismiss }}>{children}</UploadContext.Provider>;
}
