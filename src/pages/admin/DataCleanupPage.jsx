import { useState } from 'react';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { getAllSites } from '../../services/siteService';
import Modal from '../../components/common/Modal';

// closingId 포맷: `${siteId}_${year}_${MM}` — siteId 필드가 누락된 legacy 항목의 출처 복원용
function parseSiteIdFromClosingId(closingId) {
  if (!closingId) return '';
  return String(closingId).split('_')[0] || '';
}

// Firestore는 단일 batch에 최대 500개 작업 — 안전하게 400개씩 끊어서 커밋
const BATCH_SIZE = 400;

async function deleteByDocIds(collectionPath, docIds) {
  let i = 0;
  while (i < docIds.length) {
    const batch = writeBatch(db);
    const chunk = docIds.slice(i, i + BATCH_SIZE);
    chunk.forEach((id) => batch.delete(doc(db, collectionPath, id)));
    await batch.commit();
    i += BATCH_SIZE;
  }
}

export default function DataCleanupPage() {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [report, setReport] = useState(null); // { aliveSiteIds, items: [{id, kind, name, ym, qty, siteId, closingId}], counts }
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);

  async function handleScan() {
    setScanning(true);
    setScanError('');
    setReport(null);
    setDeleteResult(null);
    try {
      const sites = await getAllSites();
      const aliveSiteIds = new Set(sites.map((s) => s.id));
      const aliveSiteNames = Object.fromEntries(sites.map((s) => [s.id, s.name]));

      const [closingSnap, financeSnap] = await Promise.all([
        getDocs(collection(db, 'siteClosingItems')),
        getDocs(collection(db, 'siteFinances')),
      ]);

      const orphans = []; // { id, kind, label, ym, qty, siteId, closingId, effectiveSiteId, reason }

      const classify = (kind, d) => {
        const data = d.data();
        const siteId = data.siteId || '';
        const closingId = data.closingId || '';
        const effectiveSiteId = siteId || parseSiteIdFromClosingId(closingId);
        let reason = null;
        if (!effectiveSiteId) reason = 'siteId/closingId 모두 누락';
        else if (!aliveSiteIds.has(effectiveSiteId)) reason = '소속 사이트 삭제됨';
        if (!reason) return; // 정상

        const y = data.year ?? '?';
        const m = data.month ?? '?';
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const label = kind === 'closing'
          ? `${data.itemType || '?'} · ${data.detail || data.vendor || '(이름 없음)'}`
          : `${data.type || '?'} · ${data.description || '(설명 없음)'}`;

        let qty = 0;
        if (kind === 'closing') {
          qty = Number(data.quantity) || Object.values(data.dailyQuantities || {}).reduce((a, v) => a + (Number(v) || 0), 0);
        } else {
          qty = Number(data.amount) || 0;
        }

        orphans.push({
          id: d.id,
          kind,
          label,
          ym,
          qty,
          siteId,
          closingId,
          effectiveSiteId,
          siteName: aliveSiteNames[effectiveSiteId] || '(없음)',
          reason,
        });
      };

      closingSnap.docs.forEach((d) => classify('closing', d));
      financeSnap.docs.forEach((d) => classify('finance', d));

      // 보기 좋게 정렬 — 종류, 월, 라벨
      orphans.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        if (a.ym !== b.ym) return a.ym.localeCompare(b.ym);
        return a.label.localeCompare(b.label);
      });

      const counts = {
        total: orphans.length,
        closing: orphans.filter((x) => x.kind === 'closing').length,
        finance: orphans.filter((x) => x.kind === 'finance').length,
        scannedClosing: closingSnap.size,
        scannedFinance: financeSnap.size,
      };
      setReport({ orphans, counts });
    } catch (err) {
      console.error(err);
      setScanError(err.message || '스캔 중 오류가 발생했습니다.');
    } finally {
      setScanning(false);
    }
  }

  async function handleDelete() {
    if (!report?.orphans?.length) return;
    setDeleting(true);
    try {
      const closingIds = report.orphans.filter((x) => x.kind === 'closing').map((x) => x.id);
      const financeIds = report.orphans.filter((x) => x.kind === 'finance').map((x) => x.id);
      if (closingIds.length) await deleteByDocIds('siteClosingItems', closingIds);
      if (financeIds.length) await deleteByDocIds('siteFinances', financeIds);
      setDeleteResult({ ok: true, count: closingIds.length + financeIds.length });
      setReport(null);
    } catch (err) {
      console.error(err);
      setDeleteResult({ ok: false, message: err.message });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>데이터 정리</h2>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ marginTop: 0, color: '#555' }}>
          사이트가 삭제되거나 <code>siteId</code>가 누락된 <strong>고아 데이터</strong>를 검사합니다.
          마감 항목·지출/매출 모두 대상이며, 먼저 목록만 확인 후 일괄 삭제할 수 있어요.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleScan}
            disabled={scanning || deleting}
          >
            {scanning ? '검사 중…' : '고아 데이터 스캔'}
          </button>
          {report && report.orphans.length > 0 && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmOpen(true)}
              disabled={deleting}
            >
              {report.orphans.length}건 삭제
            </button>
          )}
        </div>
        {scanError && (
          <p style={{ color: '#c00', marginTop: 12 }}>오류: {scanError}</p>
        )}
        {deleteResult && (
          <p style={{ color: deleteResult.ok ? '#080' : '#c00', marginTop: 12 }}>
            {deleteResult.ok
              ? `삭제 완료 — 총 ${deleteResult.count}건 정리되었습니다.`
              : `삭제 실패: ${deleteResult.message}`}
          </p>
        )}
      </div>

      {report && (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ marginBottom: 12, color: '#555', fontSize: 14 }}>
            전체 스캔: 마감항목 <strong>{report.counts.scannedClosing}</strong>건 ·
            지출/매출 <strong>{report.counts.scannedFinance}</strong>건 →
            고아 마감 <strong style={{ color: '#c00' }}>{report.counts.closing}</strong>건 ·
            고아 지출/매출 <strong style={{ color: '#c00' }}>{report.counts.finance}</strong>건
          </div>

          {report.orphans.length === 0 ? (
            <p style={{ color: '#080', margin: 0 }}>✔ 고아 데이터가 없습니다.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 60 }}>종류</th>
                    <th style={{ minWidth: 80 }}>년-월</th>
                    <th>라벨</th>
                    <th style={{ minWidth: 60 }}>수량/금액</th>
                    <th style={{ minWidth: 140 }}>사유</th>
                    <th>siteId / closingId</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orphans.map((o) => (
                    <tr key={`${o.kind}-${o.id}`}>
                      <td>{o.kind === 'closing' ? '마감' : '지출/매출'}</td>
                      <td>{o.ym}</td>
                      <td>{o.label}</td>
                      <td>{o.qty}</td>
                      <td>{o.reason}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
                        {o.siteId || '(없음)'} / {o.closingId || '(없음)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        title="고아 데이터 삭제 확인"
      >
        <p>
          총 <strong>{report?.orphans.length || 0}건</strong>의 고아 데이터를 영구 삭제합니다.
          되돌릴 수 없으니 목록을 한 번 더 확인해 주세요.
        </p>
        <p style={{ color: '#666', fontSize: 13 }}>
          마감 {report?.counts.closing || 0}건 · 지출/매출 {report?.counts.finance || 0}건
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? '삭제 중…' : '삭제'}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setConfirmOpen(false)}
            disabled={deleting}
          >
            취소
          </button>
        </div>
      </Modal>
    </div>
  );
}
