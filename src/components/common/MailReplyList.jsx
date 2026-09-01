import Icon from './Icon';

// 업체가 보낸 답장 — 발주서·마감 리스트가 함께 쓴다.
//
// 답장은 지금까지 네이버 메일함에만 있었다. 「그 업체가 뭐라고 했더라」를 보려면
// 앱을 나가 메일함을 뒤져야 했고, 그 사이 어느 발주 건이었는지 놓쳤다.
// 이제 그 건 옆에 붙여 둔다 (2026-09-01 대표님).
//
// 첨부는 이름만 적는다. 파일은 네이버에 있다 — 앱으로 끌어오면 열린 데이터베이스에
// 업체 서류가 쌓인다 (2026-08-28 대표님 「표시만」).

function fmt(v) {
  const d = v?.toDate ? v.toDate() : v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const 오늘 = new Date();
  const 같은해 = d.getFullYear() === 오늘.getFullYear();
  const 날짜 = `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  const 시각 = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return 같은해 ? `${날짜} ${시각}` : `${d.getFullYear()}.${날짜} ${시각}`;
}

// 답장 본문에는 우리가 보낸 원문이 통째로 따라온다(> 로 시작하는 인용).
// 업체가 새로 쓴 말만 남겨야 읽을 것이 보인다.
function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break; // 인용이 시작되면 그 뒤는 우리가 보낸 글
    if (/님이 작성:?\s*$/.test(line)) break; // 「…님이 작성:」 도 인용의 머리
    out.push(line);
  }
  return out.join('\n').trim() || String(text || '').trim();
}

export default function MailReplyList({ replies = [], compact = false }) {
  if (!replies.length) return null;
  return (
    <div className={`mail-replies${compact ? ' is-compact' : ''}`}>
      {replies.map((r) => (
        <div className="mail-reply" key={r.id}>
          <div className="mail-reply-head">
            <Icon name="mail" className="mail-reply-ic" />
            <strong className="mail-reply-from">{r.from || r.vendor || '업체'}</strong>
            <span className="mail-reply-at">{fmt(r.receivedAt)}</span>
          </div>
          {r.subject && <div className="mail-reply-subject">{r.subject}</div>}
          <p className="mail-reply-body">{stripQuoted(r.text)}</p>
          {(r.attachments || []).length > 0 && (
            <div className="mail-reply-files">
              {r.attachments.map((a, i) => (
                <span className="mail-reply-file" key={`${a.filename}-${i}`} title="파일은 네이버 메일함에 있습니다">
                  <Icon name="doc" className="btn-ic" />
                  {a.filename}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
