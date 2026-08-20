import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import Icon from '../../components/common/Icon';
import Modal from '../../components/common/Modal';
import { getSuppliers, getPurchases, subscribePurchaseItems } from '../../services/purchaseService';
import { getVendors } from '../../services/outsourceService';
import { addMailLog, getMailLogs } from '../../services/mailService';
import { callSendEmail, ensureAnonymousAuth } from '../../config/firebase';
import { computeSupplierList } from '../../utils/purchaseOrder';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fmtDateTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 업체 다중 선택 → 동일한 메일을 한 번에 발송 (구매처 / 외주)
export default function MailSendPage() {
  const { toast } = useDialog();
  const { userProfile } = useAuth();
  const [mode, setMode] = useState('compose'); // 'compose' | 'history'
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [targetType, setTargetType] = useState('supplier'); // 'supplier' | 'vendor'
  const [suppliers, setSuppliers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [purchases, setPurchases] = useState([]); // 발주서별 선택용
  const [itemMaster, setItemMaster] = useState([]);
  const [poFilter, setPoFilter] = useState(''); // 선택된 발주서 id
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [sp, vd, ps] = await Promise.all([getSuppliers(), getVendors(), getPurchases()]);
        setSuppliers(sp);
        setVendors(vd);
        setPurchases(ps);
      } catch (err) {
        console.error(err);
      }
    })();
    const unsub = subscribePurchaseItems(setItemMaster);
    return () => unsub();
  }, []);

  // 대상 유형 바꾸면 선택·발주서 필터 초기화
  useEffect(() => {
    setSelected(new Set());
    setPoFilter('');
  }, [targetType]);

  // 발주서를 고르면 그 발주서에 속한(이메일 등록) 구매처만 선택
  function selectByPO(purchaseId) {
    setPoFilter(purchaseId);
    if (!purchaseId) {
      setSelected(new Set());
      return;
    }
    const p = purchases.find((x) => x.id === purchaseId);
    if (!p) return;
    const supList = computeSupplierList(p.items || [], itemMaster, suppliers, p);
    // 재고로 다 채워 보낼 발주분이 없는 업체는 고르지 않는다
    const names = new Set(supList.filter((s) => s.orderCount > 0).map((s) => s.name));
    const ids = suppliers.filter((s) => names.has(s.name) && s.email).map((s) => s.id);
    setSelected(new Set(ids));
  }

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await getMailLogs());
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (mode === 'history') loadLogs();
  }, [mode, loadLogs]);

  const list = targetType === 'supplier' ? suppliers : vendors;
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return list.filter(
      (c) => !kw || (c.name || '').toLowerCase().includes(kw) || (c.email || '').toLowerCase().includes(kw),
    );
  }, [list, search]);
  const withEmail = filtered.filter((c) => c.email);
  const allSel = withEmail.length > 0 && withEmail.every((c) => selected.has(c.id));

  function toggleAll() {
    setSelected(() => (allSel ? new Set() : new Set(withEmail.map((c) => c.id))));
  }
  function toggle(id) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function addFiles(fl) {
    const fs = Array.from(fl || []);
    if (fs.length) setFiles((p) => [...p, ...fs]);
  }

  // 수신 대상(이메일 등록 + 선택)
  const recipients = useMemo(() => list.filter((c) => selected.has(c.id) && c.email), [list, selected]);
  const selectedCount = recipients.length;
  // 실제 발송될 본문 HTML (미리보기 = 발송본 동일)
  const previewHtml = useMemo(() => {
    const b = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px;font-weight:700">발신 : (주)아이오피엔</p><p>${b}</p>`;
  }, [body]);

  // 발송 버튼 → 검증 후 미리보기 모달 열기 (바로 발송 X)
  function openPreview() {
    if (recipients.length === 0) {
      toast('수신 업체를 선택하세요. (이메일이 등록된 업체만 발송됩니다)', 'error');
      return;
    }
    if (!subject.trim()) {
      toast('제목을 입력하세요.', 'error');
      return;
    }
    const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
    if (totalSize > 8 * 1024 * 1024) {
      toast('첨부 용량이 너무 큽니다 (총 8MB 이하).', 'error');
      return;
    }
    setPreviewOpen(true);
  }

  // 미리보기 모달의 '발송' → 실제 발송
  async function confirmSend() {
    if (sending) return;
    setPreviewOpen(false);
    setSending(true);
    setProgress({ done: 0, total: recipients.length });
    try {
      await ensureAnonymousAuth();
      const attachments = [];
      for (const f of files) {
        const b64 = await blobToBase64(f);
        attachments.push({ filename: f.name, content: b64, encoding: 'base64' });
      }
      let ok = 0;
      const fail = [];
      let firstErr = '';
      for (let i = 0; i < recipients.length; i += 1) {
        const r = recipients[i];
        try {
          await callSendEmail({ to: r.email, subject: subject.trim(), html: previewHtml, attachments });
          ok += 1;
        } catch (e) {
          fail.push(r.name);
          if (!firstErr) firstErr = e?.message || String(e);

          console.error('메일 발송 실패', r.email, e);
        }
        setProgress({ done: i + 1, total: recipients.length });
      }
      try {
        await addMailLog({
          by: userProfile?.name || '',
          targetType,
          subject: subject.trim(),
          total: recipients.length,
          okCount: ok,
          failCount: fail.length,
          recipients: recipients.map((r) => ({ name: r.name, email: r.email })),
          failNames: fail,
          fileNames: files.map((f) => f.name),
        });
      } catch {
        /* 이력 기록 실패는 무시 */
      }
      if (fail.length === 0) {
        toast(`${ok}개 업체에 발송 완료했습니다.`, 'success', 0);
        setSelected(new Set());
      } else {
        toast(
          `${ok}개 발송 · 실패 ${fail.length}개 (${fail.join(', ')})${firstErr ? ` — ${firstErr}` : ''}`,
          'error',
          0,
        );
      }
    } catch (err) {
      toast('발송 오류: ' + (err.message || err), 'error');
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <div className="mail-send-page">
      {/* 상단 탭 — 메일 작성 / 발송 이력 (제목 위 — 상단 탭 표준) */}
      <div className="tab-nav no-print" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`tab-nav-item ${mode === 'compose' ? 'active' : ''}`}
          onClick={() => setMode('compose')}
        >
          메일 작성
        </button>
        <button
          type="button"
          className={`tab-nav-item ${mode === 'history' ? 'active' : ''}`}
          onClick={() => setMode('history')}
        >
          발송 이력
        </button>
      </div>

      <div className="page-header">
        <h2>메일 발송</h2>
        <div className="page-actions">
          {mode === 'compose' && (
            <button type="button" className="btn btn-sm btn-primary" onClick={openPreview} disabled={sending}>
              <Icon name={sending ? 'clock' : 'mail'} className="btn-ic" />
              {sending && progress ? `발송 중 ${progress.done}/${progress.total}` : `발송 (${selectedCount})`}
            </button>
          )}
        </div>
      </div>

      {mode === 'history' ? (
        <div className="mail-history">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button type="button" className="btn btn-sm btn-outline" onClick={loadLogs} disabled={logsLoading}>
              <Icon name="restore" className="btn-ic" />
              새로고침
            </button>
          </div>
          {logsLoading ? (
            <p className="text-muted">불러오는 중...</p>
          ) : logs.length === 0 ? (
            <div className="trash-empty">발송 이력이 없습니다.</div>
          ) : (
            <div className="table-scroll-x">
              <table className="table cards-sm">
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 140 }}>
                      발송일시
                    </th>
                    <th scope="col" style={{ width: 70 }}>
                      대상
                    </th>
                    <th scope="col">제목</th>
                    <th scope="col" style={{ width: 90 }}>
                      수신/성공
                    </th>
                    <th scope="col" style={{ width: 70 }}>
                      발송자
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td data-label="발송일시">{fmtDateTime(l.createdAt)}</td>
                      <td data-label="대상">{l.targetType === 'vendor' ? '외주' : '구매처'}</td>
                      <td data-label="제목">
                        <strong>{l.subject || '(제목 없음)'}</strong>
                        <div
                          className="field-hint"
                          style={{ margin: '2px 0 0' }}
                          title={(l.recipients || []).map((r) => r.name).join(', ')}
                        >
                          {(l.recipients || []).map((r) => r.name).join(', ')}
                          {l.fileNames?.length ? ` · 첨부 ${l.fileNames.length}` : ''}
                        </div>
                      </td>
                      <td data-label="수신/성공">
                        {l.okCount ?? 0}/{l.total ?? 0}
                        {l.failCount ? (
                          <span style={{ color: 'var(--danger,#dc2626)' }}> (실패 {l.failCount})</span>
                        ) : (
                          ''
                        )}
                      </td>
                      <td data-label="발송자">{l.by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="field-hint" style={{ margin: '0 0 12px' }}>
            업체를 여러 개 선택해 같은 내용의 메일을 한 번에 보냅니다. 이메일이 등록된 업체만 발송됩니다.{' '}
            <strong>발주서로 선택</strong>하면 그 발주서에 속한 구매처만 자동 선택됩니다.
          </p>

          {/* 대상 유형 */}
          <div className="tab-nav no-print" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`tab-nav-item ${targetType === 'supplier' ? 'active' : ''}`}
              onClick={() => setTargetType('supplier')}
            >
              구매처
            </button>
            <button
              type="button"
              className={`tab-nav-item ${targetType === 'vendor' ? 'active' : ''}`}
              onClick={() => setTargetType('vendor')}
            >
              외주 업체
            </button>
          </div>

          <div className="mail-send-grid">
            {/* 수신 업체 선택 */}
            <div className="mail-send-recipients">
              <label className="mail-send-label">수신 업체</label>
              {targetType === 'supplier' && (
                <div className="mail-send-po-row">
                  <select
                    className="payment-month-select mail-send-po-select"
                    value={poFilter}
                    onChange={(e) => selectByPO(e.target.value)}
                    aria-label="발주서로 업체 선택"
                  >
                    <option value="">발주서로 선택…</option>
                    {purchases.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title || '(제목 없음)'}
                        {p.siteName ? ` · ${p.siteName}` : ''}
                      </option>
                    ))}
                  </select>
                  {poFilter && (
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => selectByPO('')}>
                      해제
                    </button>
                  )}
                </div>
              )}
              <div className="mail-send-recipients__bar">
                <input
                  type="search"
                  placeholder="업체명·이메일 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="업체 검색"
                />
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={toggleAll}
                  disabled={withEmail.length === 0}
                >
                  {allSel ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="mail-send-list">
                {filtered.length === 0 ? (
                  <p className="purchase-empty">업체가 없습니다.</p>
                ) : (
                  filtered.map((c) => {
                    const noEmail = !c.email;
                    return (
                      <label
                        key={c.id}
                        className={`mail-send-item ${selected.has(c.id) ? 'is-checked' : ''} ${noEmail ? 'is-disabled' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => !noEmail && toggle(c.id)}
                          disabled={noEmail}
                        />
                        <span className="mail-send-item__name">{c.name || '(이름 없음)'}</span>
                        <span className="mail-send-item__email">{c.email || '이메일 없음'}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <p className="field-hint" style={{ margin: '6px 2px 0' }}>
                선택 {selectedCount}개 · 이메일 등록 {withEmail.length}개 / 전체 {filtered.length}개
              </p>
            </div>

            {/* 메일 작성 */}
            <div className="mail-send-compose">
              <div className="form-group">
                <label>제목</label>
                <input
                  aria-label="제목"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="메일 제목"
                />
              </div>
              <div className="form-group">
                <label>본문</label>
                <textarea
                  aria-label="본문"
                  rows={10}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="메일 본문을 입력하세요. (발신: (주)아이오피엔 이 자동으로 상단에 표시됩니다)"
                  style={{ fontSize: 14, lineHeight: 1.6 }}
                />
              </div>
              <div className="form-group">
                <label>첨부파일 (선택)</label>
                <input
                  aria-label="첨부파일 (선택)"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const fl = e.target.files;
                    e.target.value = '';
                    addFiles(fl);
                  }}
                />
                <div
                  className={`pdf-dropzone ${dragOver ? 'is-over' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget)) return;
                    setDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    addFiles(e.dataTransfer.files);
                  }}
                >
                  <Icon name="plus" className="pdf-dropzone-icon" />
                  <span>파일을 끌어다 놓거나 클릭해서 첨부 (총 8MB 이하)</span>
                </div>
                {files.length > 0 && (
                  <ul className="mail-extra-list">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="mail-extra-item">
                        <Icon name="doc" className="mail-extra-ic" />
                        <span className="mail-extra-name" title={f.name}>
                          {f.name}
                        </span>
                        <span className="mail-extra-size">
                          {f.size < 1024 * 1024
                            ? `${Math.max(1, Math.round(f.size / 1024))}KB`
                            : `${(f.size / 1024 / 1024).toFixed(1)}MB`}
                        </span>
                        <button
                          type="button"
                          className="mail-extra-del"
                          onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="첨부 제거"
                        >
                          <Icon name="close" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="field-hint" style={{ margin: '4px 2px 0' }}>
                우측 상단 <strong>발송</strong> 버튼으로 선택한 업체에 한 번에 보냅니다.
              </p>
            </div>
          </div>
        </>
      )}

      {/* 발송 미리보기 모달 */}
      <Modal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} title="메일 발송 미리보기" size="lg">
        <div className="form-group">
          <label>수신 업체 ({recipients.length})</label>
          <div className="mail-preview-recipients">
            {recipients.map((r) => (
              <span key={r.id} className="mail-preview-chip" title={r.email}>
                {r.name}
              </span>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label>제목</label>
          <div className="mail-preview-subject">{subject.trim() || '(제목 없음)'}</div>
        </div>
        {files.length > 0 && (
          <div className="form-group">
            <label>첨부파일 ({files.length})</label>
            <ul className="mail-extra-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="mail-extra-item">
                  <Icon name="doc" className="mail-extra-ic" />
                  <span className="mail-extra-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="mail-extra-size">
                    {f.size < 1024 * 1024
                      ? `${Math.max(1, Math.round(f.size / 1024))}KB`
                      : `${(f.size / 1024 / 1024).toFixed(1)}MB`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-group">
          <label>본문 미리보기</label>
          <div className="mail-body-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={confirmSend} disabled={sending}>
            <Icon name="mail" className="btn-ic" />
            {recipients.length}개 업체에 발송
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setPreviewOpen(false)}>
            취소
          </button>
        </div>
      </Modal>
    </div>
  );
}
