import { useState, useEffect } from 'react';
import Modal from './Modal';
import Select from './Select';
import { useDialog } from './DialogProvider';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeFolders } from '../../services/fileLibraryService';
import { captureToPdfBlob, uploadPdfToLibrary } from '../../utils/pdfExport';

// 발주서·견적서·BOM 등 인쇄 양식(.print-form-iopn.print-only)을 공용으로 처리하는 우하단 FAB.
//   - 「PDF 출력」  = 브라우저 인쇄(window.print) — 가장 선명
//   - 「자료실 저장」 = 서버 렌더(page.pdf, 인쇄와 동일 엔진) PDF를 백그라운드로 자료실 업로드
// props:
//   defaultFileName: string | () => string  — 모달 기본 파일명
//   onBeforeOutput?: () => void              — 출력/저장 직전 호출(예: 출력 시각 스탬프)
//   targetSelector?: string                  — 캡처할 인쇄 양식 선택자(기본 .print-form-iopn.print-only)
export default function PdfFabGroup({
  defaultFileName,
  onBeforeOutput,
  targetSelector = '.print-form-iopn.print-only',
}) {
  const { userProfile } = useAuth();
  const { alert, toast } = useDialog();
  const [folders, setFolders] = useState([]);
  const [open, setOpen] = useState(false);
  const [folderId, setFolderId] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    const unsub = subscribeFolders((list) => {
      const byId = new Map(list.map((f) => [f.id, f]));
      const labelOf = (f) => {
        const parts = [];
        let cur = f;
        let guard = 0;
        while (cur && guard < 20) {
          parts.unshift(cur.name);
          cur = cur.parentId ? byId.get(cur.parentId) : null;
          guard += 1;
        }
        return parts.join(' / ');
      };
      setFolders(list.map((f) => ({ id: f.id, label: labelOf(f) })).sort((a, b) => a.label.localeCompare(b.label)));
    });
    return () => unsub();
  }, []);

  function resolveName() {
    const n = typeof defaultFileName === 'function' ? defaultFileName() : defaultFileName;
    return (n || '문서').replace(/[/\\]/g, '_');
  }

  function openModal() {
    setFileName(resolveName());
    setOpen(true);
  }

  function handleOutput() {
    onBeforeOutput?.();
    setTimeout(() => window.print(), 120);
  }

  // 자료실 저장 — 모달 즉시 닫고 백그라운드로 생성·업로드 (기다리지 않음)
  function handleSave() {
    const el = document.querySelector(targetSelector);
    if (!el) {
      alert('인쇄 양식을 찾을 수 없습니다.');
      return;
    }
    const name = `${fileName || '문서'}.pdf`;
    const fid = folderId || null;
    setOpen(false);
    // 시작 토스트 없음 — 결과만 sticky 토스트(X로 닫음)로 알림(총괄 수칙: 저장은 백그라운드+결과만)
    (async () => {
      try {
        onBeforeOutput?.();
        await new Promise((r) => setTimeout(r, 80));
        const blob = await captureToPdfBlob(el, name);
        await uploadPdfToLibrary(blob, fileName, fid, userProfile);
        toast(`자료실에 저장되었습니다: ${name}`, 'success', 0);
      } catch (err) {
        toast(`자료실 저장 실패: ${err?.message || err}`, 'error', 0);
      }
    })();
  }

  return (
    <>
      <div className="pdf-fab-group no-print">
        <button
          type="button"
          className="pdf-print-fab pdf-fab-secondary"
          onClick={openModal}
          title="PDF 파일로 만들어 사내 자료실에 저장합니다"
        >
          자료실 저장
        </button>
        <button
          type="button"
          className="pdf-print-fab"
          onClick={handleOutput}
          title="브라우저 인쇄로 출력합니다 (인쇄 대화상자에서 'PDF로 저장' 선택 가능)"
        >
          PDF 출력
        </button>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="PDF로 자료실 저장">
        <p className="field-hint">
          현재 양식을 PDF 파일로 만들어 사내 자료실에 보관합니다. 저장 위치 폴더와 파일명을 지정하세요.
        </p>
        <div className="form-group">
          <label>파일명</label>
          <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="파일명" />
          <p className="field-hint">확장자(.pdf)는 자동으로 붙습니다.</p>
        </div>
        <div className="form-group">
          <label>저장 폴더</label>
          <Select
            value={folderId}
            onChange={setFolderId}
            options={folders.map((f) => ({ value: f.id, label: f.label }))}
            placeholder="자료실 최상위 (폴더 없음)"
            ariaLabel="저장 폴더 선택"
          />
        </div>
        <p className="field-hint">
          「자료실에 저장」을 누르면 <strong>바로 닫히고</strong> 뒤에서 진행됩니다. 완료되면 알림으로 알려드려요 —
          기다리실 필요 없습니다.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!fileName.trim()}>
            자료실에 저장
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
            취소
          </button>
        </div>
      </Modal>
    </>
  );
}
