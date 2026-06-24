import { useState, useEffect, useRef, useMemo } from 'react';
import { useDialog } from '../../components/common/DialogProvider';
import Icon from '../../components/common/Icon';
import { getSuppliers } from '../../services/purchaseService';
import { getVendors } from '../../services/outsourceService';
import { callSendEmail, ensureAnonymousAuth } from '../../config/firebase';

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 업체 다중 선택 → 동일한 메일을 한 번에 발송 (구매처 / 외주)
export default function MailSendPage() {
  const { toast, confirm } = useDialog();
  const [targetType, setTargetType] = useState('supplier'); // 'supplier' | 'vendor'
  const [suppliers, setSuppliers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const fileInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [sp, vd] = await Promise.all([getSuppliers(), getVendors()]);
        setSuppliers(sp);
        setVendors(vd);
      } catch (err) {
        console.error(err);
      }
    })();
  }, []);

  // 대상 유형 바꾸면 선택 초기화
  useEffect(() => {
    setSelected(new Set());
  }, [targetType]);

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

  async function send() {
    if (sending) return;
    const recipients = list.filter((c) => selected.has(c.id) && c.email);
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
    if (
      !(await confirm({
        title: '메일 발송',
        message: `선택한 ${recipients.length}개 업체에 동일한 메일을 발송할까요?`,
      }))
    )
      return;

    setSending(true);
    setProgress({ done: 0, total: recipients.length });
    try {
      await ensureAnonymousAuth();
      const bodyHtml = body
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      const html = `<p style="margin:0 0 14px;font-weight:700">발신 : (주)아이오피엔</p><p>${bodyHtml}</p>`;
      const attachments = [];
      for (const f of files) {
        const b64 = await blobToBase64(f);
        attachments.push({ filename: f.name, content: b64, encoding: 'base64' });
      }
      let ok = 0;
      const fail = [];
      for (let i = 0; i < recipients.length; i += 1) {
        const r = recipients[i];
        try {
          await callSendEmail({ to: r.email, subject: subject.trim(), html, attachments });
          ok += 1;
        } catch {
          fail.push(r.name);
        }
        setProgress({ done: i + 1, total: recipients.length });
      }
      if (fail.length === 0) toast(`${ok}개 업체에 발송 완료했습니다.`, 'success', 0);
      else toast(`${ok}개 발송, 실패 ${fail.length}개: ${fail.join(', ')}`, 'error', 0);
      setSelected(new Set());
    } catch (err) {
      toast('발송 오류: ' + (err.message || err), 'error');
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  const selectedCount = list.filter((c) => selected.has(c.id) && c.email).length;

  return (
    <div className="mail-send-page">
      <div className="page-header">
        <h2>메일 발송</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={send} disabled={sending}>
            <Icon name={sending ? 'clock' : 'mail'} className="btn-ic" />
            {sending && progress ? `발송 중 ${progress.done}/${progress.total}` : `발송 (${selectedCount})`}
          </button>
        </div>
      </div>
      <p className="field-hint" style={{ margin: '0 0 12px' }}>
        업체를 여러 개 선택해 같은 내용의 메일을 한 번에 보냅니다. 이메일이 등록된 업체만 발송됩니다.
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
          <div className="mail-send-recipients__bar">
            <input
              type="search"
              placeholder="업체명·이메일 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="업체 검색"
            />
            <button type="button" className="btn btn-sm btn-outline" onClick={toggleAll} disabled={withEmail.length === 0}>
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
                  <label key={c.id} className={`mail-send-item ${selected.has(c.id) ? 'is-checked' : ''} ${noEmail ? 'is-disabled' : ''}`}>
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
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="메일 제목" />
          </div>
          <div className="form-group">
            <label>본문</label>
            <textarea
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
                      ×
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
    </div>
  );
}
