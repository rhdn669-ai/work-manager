import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../common/DialogProvider';
import { useAuth } from '../../contexts/AuthContext';
import PurchaseOrderPrintForm from './PurchaseOrderPrintForm';
import { captureToPdfBlob } from '../../utils/pdfExport';
import { replaceLibraryFile } from '../../services/fileLibraryService';

// 발주서 저장본 일괄 재생성 "백그라운드 실행기".
// ▸ 총괄 수칙: 저장/업로드/PDF 생성은 모달로 대기시키지 않고 항상 백그라운드로 처리한다.
//   off-screen 렌더 하네스를 모달이 아닌 상위(항상 마운트)에 두어, 모달이 닫혀도 처리가 끊기지 않게 한다.
// task: { jobs, suppliers, sites, itemMaster } | null  (모달이 분석 후 넘겨줌)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtStamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function RegenOrderPdfRunner({ task, onDone }) {
  const { toast } = useDialog();
  const { userProfile } = useAuth();
  const [job, setJob] = useState(null);
  const formRef = useRef(null);
  const stampRef = useRef('');
  const runningRef = useRef(false);

  useEffect(() => {
    if (!task || runningRef.current) return;
    runningRef.current = true;
    (async () => {
      const { jobs, suppliers, sites, itemMaster } = task;
      stampRef.current = fmtStamp(new Date());
      // 시작·진행 토스트는 띄우지 않는다 — 모달 닫힘이 시작 신호, 결과만 sticky 토스트로 알림(총괄 수칙)
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        try {
          setJob({ ...j, _suppliers: suppliers, _sites: sites, _itemMaster: itemMaster });
          await sleep(280); // React 렌더 반영 대기
          const el = formRef.current;
          if (!el) throw new Error('양식 렌더 실패');
          const blob = await captureToPdfBlob(el, j.file.name);
          await replaceLibraryFile(j.file, blob, userProfile);
          ok++;
        } catch (e) {
          fail++;
          console.error('[저장본 재생성]', j.file?.name, e?.message || e);
        }
      }
      setJob(null);
      runningRef.current = false;
      // 결과 토스트 — X 누를 때까지 유지(sticky)
      if (fail === 0) toast(`발주서 저장본 ${ok}건 재생성 완료`, 'success', 0);
      else toast(`재생성 완료 ${ok}건 · 실패 ${fail}건 (콘솔 확인)`, 'error', 0);
      onDone && onDone();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const j = job;
  const renderForm = j
    ? {
        items: j.purchase.items || [],
        note: j.purchase.note || '',
        supplierNotes: j.purchase.supplierNotes || {},
        deliveryPlace: j.purchase.deliveryPlace || '',
      }
    : null;

  // 화면 밖 렌더 — captureToPdfBlob 은 outerHTML 직렬화라 위치/표시와 무관
  return (
    <div aria-hidden style={{ position: 'fixed', left: -100000, top: 0, width: '210mm', pointerEvents: 'none' }}>
      {j && (
        <PurchaseOrderPrintForm
          ref={formRef}
          purchase={j.purchase}
          form={renderForm}
          suppliers={j._suppliers}
          sites={j._sites}
          itemMaster={j._itemMaster}
          printSupplierFilter={j.supplierName}
          printAccountMode={true}
          printSiteNameMode={null}
          printStamp={stampRef.current}
        />
      )}
    </div>
  );
}
