import { useEffect, useMemo, useState } from 'react';
import Modal from '../common/Modal';
import { useDialog } from '../common/DialogProvider';
import {
  subscribeFolders,
  subscribeFiles,
} from '../../services/fileLibraryService';
import { getPurchases, getSuppliers, getPurchaseItems } from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { poDateStr, computeSupplierList } from '../../utils/purchaseOrder';

// 발주서 "저장본 일괄 재생성" — 분석/시작 전용 모달.
// 실제 재생성은 백그라운드 실행기(RegenOrderPdfRunner)가 처리한다(총괄 수칙: 저장은 백그라운드).
// 이 모달은 대상 건수를 보여주고, 「재생성 시작」을 누르면 잡 목록을 부모로 넘기고 닫힌다.
// busy: 이미 백그라운드 재생성이 진행 중이면 시작 비활성화.

export default function RegenOrderPdfModal({ isOpen, onClose, onStart, busy = false }) {
  const { confirm } = useDialog();

  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);

  // 자료실 폴더/파일 실시간 구독 + 발주 기준 데이터 1회 로드
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const unsubF = subscribeFolders(setFolders);
    const unsubFi = subscribeFiles(setFiles);
    (async () => {
      try {
        const [ps, sup, items, st] = await Promise.all([
          getPurchases(),
          getSuppliers(),
          getPurchaseItems(),
          getAllSites(),
        ]);
        setPurchases(ps);
        setSuppliers(sup);
        setItemMaster(items);
        setSites(st);
      } catch (e) {
        console.error('[저장본 재생성] 데이터 로드 실패:', e);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      unsubF && unsubF();
      unsubFi && unsubFi();
    };
  }, [isOpen]);

  // 발주이력 폴더(및 그 월별 하위) 안에 있는 파일 id 집합
  const orderFolderIds = useMemo(() => {
    const hist = new Set(folders.filter((f) => f.name === '발주이력').map((f) => f.id));
    const ids = new Set(hist);
    for (const f of folders) {
      if (f.parentId && hist.has(f.parentId)) ids.add(f.id); // 월별 YYYY-MM 하위
    }
    return ids;
  }, [folders]);

  // 파일 → (발주 건, 구매처) 매칭. 발행번호 IOPN{날짜}-{순번}-{ID4} 우선.
  const { jobs, unresolved } = useMemo(() => {
    const jobs = [];
    const unresolved = [];
    if (loading) return { jobs, unresolved };
    const byIdTail = (tail) =>
      purchases.find((p) => (p.id || '').slice(0, 4).toUpperCase() === tail.toUpperCase());
    const orderFiles = files.filter(
      (f) => orderFolderIds.has(f.folderId) && /\.pdf$/i.test(f.name || ''),
    );
    for (const file of orderFiles) {
      const name = file.name || '';
      // ① 업체별 발행번호: IOPN20260101-2-AB12
      let m = name.match(/IOPN(\d{8})-(\d+)-([0-9A-Za-z]{4})/);
      if (m) {
        const purchase = byIdTail(m[3]);
        if (!purchase) {
          unresolved.push({ name, reason: '원본 발주 없음(삭제됨)' });
          continue;
        }
        const supList = computeSupplierList(purchase.items, itemMaster, suppliers, purchase);
        let supplierName = supList.find((s) => s.name && name.includes(s.name))?.name;
        if (!supplierName) supplierName = supList[Number(m[2]) - 1]?.name || null;
        if (!supplierName) {
          unresolved.push({ name, reason: '구매처 매칭 실패' });
          continue;
        }
        jobs.push({ file, purchase, supplierName, kind: '업체별' });
        continue;
      }
      // ② 전체 발행번호: IOPN20260101-AB12
      m = name.match(/IOPN(\d{8})-([0-9A-Za-z]{4})(?![0-9A-Za-z])/);
      if (m) {
        const purchase = byIdTail(m[2]);
        if (!purchase) {
          unresolved.push({ name, reason: '원본 발주 없음(삭제됨)' });
          continue;
        }
        jobs.push({ file, purchase, supplierName: null, kind: '전체' });
        continue;
      }
      // ③ 수동 저장본: IOPN20260101_제목
      m = name.match(/IOPN(\d{8})_/);
      if (m) {
        const stamp = `IOPN${m[1]}`;
        const purchase = purchases.find(
          (p) => poDateStr(p) === stamp && (p.title || '').trim() && name.includes((p.title || '').trim()),
        );
        if (!purchase) {
          unresolved.push({ name, reason: '발주 건 매칭 실패' });
          continue;
        }
        jobs.push({ file, purchase, supplierName: null, kind: '전체' });
        continue;
      }
      unresolved.push({ name, reason: '발행번호 없음 — 식별 불가' });
    }
    return { jobs, unresolved };
  }, [files, orderFolderIds, purchases, suppliers, itemMaster, loading]);

  async function handleStart() {
    if (jobs.length === 0 || busy) return;
    if (
      !(await confirm(
        `발주서 저장본 ${jobs.length}건을 내부용 양식(계좌+현장명 포함)으로 재생성합니다.\n작업은 백그라운드로 진행되며, 완료되면 알림으로 알려드립니다.\n메일 첨부본은 영향이 없습니다. 진행할까요?`,
      ))
    )
      return;
    onStart && onStart({ jobs, suppliers, sites, itemMaster });
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="발주서 저장본 일괄 재생성" size="lg">
      <div className="regen-po">
        <p className="regen-po__desc">
          자료실 <strong>발주이력</strong>에 저장된 발주서 PDF를 현재 <strong>내부용 양식</strong>(구매처 계좌 +
          실제 현장명 포함)으로 다시 만들어 같은 파일을 갱신합니다. 메일 첨부본(외부용)은 영향이 없습니다.
        </p>
        <p className="regen-po__warn">
          ※ 원본 발주 데이터로 재렌더링하므로, 저장 이후 발주 내용이 변경된 건은 그 변경도 함께 반영됩니다. 작업은
          백그라운드로 진행되어 도중에 다른 작업을 하셔도 됩니다. (배포 환경에서만 동작)
        </p>

        {loading ? (
          <div className="regen-po__loading">자료실·발주 데이터 불러오는 중…</div>
        ) : (
          <>
            <div className="regen-po__summary">
              <span className="regen-po__chip regen-po__chip--ok">재생성 대상 {jobs.length}건</span>
              {unresolved.length > 0 && (
                <span className="regen-po__chip regen-po__chip--skip">식별 불가 {unresolved.length}건</span>
              )}
              {busy && <span className="regen-po__chip regen-po__chip--skip">백그라운드 재생성 진행 중…</span>}
            </div>

            {unresolved.length > 0 && (
              <details className="regen-po__unresolved">
                <summary>식별 불가 {unresolved.length}건 (재생성 제외)</summary>
                {unresolved.map((u, i) => (
                  <div key={i} className="regen-po__row is-skip">
                    <span className="regen-po__row-name">{u.name}</span>
                    <span className="regen-po__row-msg">{u.reason}</span>
                  </div>
                ))}
              </details>
            )}

            <div className="regen-po__actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>
                닫기
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleStart}
                disabled={jobs.length === 0 || busy}
              >
                {busy ? '재생성 진행 중…' : `재생성 시작 (${jobs.length}건)`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
