import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  subscribeChannelMessages, sendChannelMessage, sendChannelImage, sendChannelFile,
  deleteChannelMessage, editChannelMessage, deleteAllChannelMessages,
  toggleChannelReaction, pinChannelMessage, getPinnedChannelMessage, markChannelRead,
  setChannelTyping, subscribeChannelTyping,
} from '../services/channelService';
import { getUsers } from '../services/userService';

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
function formatTime(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function formatDate(ts) {
  if (!ts?.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}
function highlight(text, keyword) {
  if (!keyword) return text;
  const parts = text.split(new RegExp(`(${keyword})`, 'gi'));
  return parts.map((p, i) =>
    p.toLowerCase() === keyword.toLowerCase() ? <mark key={i} className="chat-highlight">{p}</mark> : p
  );
}

export default function ChannelChatPage({ channel, onBack, onGoToDm }) {
  const { userProfile, isAdmin } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const [menuMsg, setMenuMsg] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [pinnedMsg, setPinnedMsg] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [users, setUsers] = useState([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMention, setShowMention] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const lastReadRef = useRef({});

  useEffect(() => {
    const unsub = subscribeChannelMessages(channel.id, (msgs) => {
      setMessages(msgs);
      msgs.forEach((m) => {
        if (m.readBy && !m.readBy[userProfile?.uid] && m.userId !== userProfile?.uid) {
          if (!lastReadRef.current[m.id]) {
            lastReadRef.current[m.id] = true;
            markChannelRead(channel.id, m.id, userProfile.uid);
          }
        }
      });
    });
    return () => unsub();
  }, [channel.id, userProfile?.uid]);

  useEffect(() => {
    getPinnedChannelMessage(channel.id).then(setPinnedMsg);
  }, [channel.id]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const unsub = subscribeChannelTyping(channel.id, userProfile.uid, setTypingUsers);
    return () => unsub();
  }, [channel.id, userProfile?.uid]);

  useEffect(() => {
    getUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleTextChange(e) {
    const val = e.target.value;
    setText(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx !== -1 && (atIdx === val.length - 1 || !val.slice(atIdx + 1).includes(' '))) {
      setMentionQuery(val.slice(atIdx + 1));
      setShowMention(true);
    } else {
      setShowMention(false);
    }
    if (!userProfile?.uid) return;
    setChannelTyping(channel.id, userProfile.uid, userProfile.name, true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setChannelTyping(channel.id, userProfile.uid, userProfile.name, false), 2000);
  }

  function insertMention(user) {
    const atIdx = text.lastIndexOf('@');
    setText(text.slice(0, atIdx) + `@${user.name} `);
    setShowMention(false);
    inputRef.current?.focus();
  }

  async function handleSend(e) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    clearTimeout(typingTimer.current);
    setChannelTyping(channel.id, userProfile.uid, userProfile.name, false);
    try {
      if (editingMsg) {
        await editChannelMessage(channel.id, editingMsg.id, trimmed);
        setEditingMsg(null);
      } else {
        await sendChannelMessage({ channelId: channel.id, userId: userProfile.uid, userName: userProfile.name, position: userProfile.position || '', text: trimmed, replyTo });
        setReplyTo(null);
      }
      setText('');
      setShowMention(false);
    } catch (err) { alert('전송 실패: ' + err.message); }
    finally { setSending(false); }
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      await sendChannelImage({ channelId: channel.id, userId: userProfile.uid, userName: userProfile.name, position: userProfile.position || '', file, replyTo });
      setReplyTo(null);
    } catch (err) { alert('이미지 전송 실패: ' + err.message); }
    finally { setSending(false); e.target.value = ''; }
  }

  async function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert('파일 크기는 20MB 이하만 가능합니다.'); e.target.value = ''; return; }
    setSending(true);
    try {
      await sendChannelFile({ channelId: channel.id, userId: userProfile.uid, userName: userProfile.name, position: userProfile.position || '', file, replyTo });
      setReplyTo(null);
    } catch (err) { alert('파일 전송 실패: ' + err.message); }
    finally { setSending(false); e.target.value = ''; }
  }

  async function handleDelete(msg) {
    if (!window.confirm('메시지를 삭제할까요?')) return;
    await deleteChannelMessage(channel.id, msg.id);
    setMenuMsg(null);
  }

  async function handleDeleteAll() {
    if (!window.confirm('채팅 내역을 전체 삭제할까요?\n이 작업은 되돌릴 수 없습니다.')) return;
    await deleteAllChannelMessages(channel.id);
    setPinnedMsg(null);
  }

  async function handlePin(msg) {
    const pin = !msg.isPinned;
    await pinChannelMessage(channel.id, msg.id, pin);
    setPinnedMsg(pin ? msg : null);
    setMenuMsg(null);
  }

  async function handleReaction(msg, emoji) {
    await toggleChannelReaction(channel.id, msg.id, emoji, userProfile.uid);
    setMenuMsg(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const filtered = searchKeyword
    ? messages.filter((m) => m.text?.toLowerCase().includes(searchKeyword.toLowerCase()))
    : messages;

  const mentionFiltered = users.filter((u) =>
    u.uid !== userProfile?.uid && u.name?.includes(mentionQuery)
  ).slice(0, 5);

  let lastDate = '';

  return (
    <div className="chat-page">
      {/* 헤더 */}
      <div className="channel-chat-header">
        <button className="dm-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="channel-chat-title-wrap">
          <span className="channel-chat-title">{channel.name}</span>
          <span className="channel-chat-sub">{channel.type === 'company' ? '전사' : '부서'}</span>
        </div>
        <button className="chat-search-btn" onClick={() => { setSearchOpen(!searchOpen); setSearchKeyword(''); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
        {isAdmin && (
          <button className="chat-delete-all-btn" onClick={handleDeleteAll} title="채팅 내역 전체 삭제">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        )}
      </div>

      {/* 검색 */}
      {searchOpen && (
        <div className="chat-search-bar">
          <input className="chat-search-input" placeholder="메시지 검색..." value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)} autoFocus />
          {searchKeyword && <span className="chat-search-count">{filtered.length}건</span>}
        </div>
      )}

      {/* 고정 메시지 */}
      {pinnedMsg && !pinnedMsg.deletedAt && (
        <div className="chat-pinned">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
          <span>{pinnedMsg.userName}: {pinnedMsg.text || '사진'}</span>
          {isAdmin && <button className="chat-pinned-close" onClick={() => handlePin(pinnedMsg)}>✕</button>}
        </div>
      )}

      {/* 메시지 목록 */}
      <div className="chat-messages" onClick={() => setMenuMsg(null)}>
        {filtered.map((msg) => {
          const dateStr = formatDate(msg.createdAt);
          const showDate = dateStr && dateStr !== lastDate;
          if (showDate) lastDate = dateStr;
          const mine = msg.userId === userProfile?.uid;
          const isDeleted = !!msg.deletedAt;
          const readerCount = msg.readBy ? Object.keys(msg.readBy).length - 1 : 0;

          return (
            <div key={msg.id}>
              {showDate && <div className="chat-date-divider"><span>{dateStr}</span></div>}
              <div
                className={`chat-bubble-wrap ${mine ? 'mine' : 'theirs'}`}
                onContextMenu={(e) => { e.preventDefault(); if (!isDeleted) setMenuMsg(msg); }}
                onPointerDown={(e) => {
                  if (e.pointerType !== 'touch') return;
                  const t = setTimeout(() => { if (!isDeleted) setMenuMsg(msg); }, 500);
                  const cancel = () => { clearTimeout(t); e.target.removeEventListener('pointerup', cancel); };
                  e.target.addEventListener('pointerup', cancel);
                }}
              >
                {!mine && <div className="chat-sender">{msg.userName}{msg.position ? ` · ${msg.position}` : ''}</div>}
                {msg.replyTo && (
                  <div className="chat-reply-preview">
                    <span className="chat-reply-name">{msg.replyTo.userName}</span>
                    <span>{msg.replyTo.type === 'image' ? '사진' : msg.replyTo.type === 'file' ? `📎 ${msg.replyTo.fileName || '파일'}` : msg.replyTo.text}</span>
                  </div>
                )}
                <div className="chat-row">
                  {mine && (
                    <div className="chat-meta-left">
                      {readerCount > 0 && <span className="chat-read-count">{readerCount}</span>}
                      <span className="chat-time">{formatTime(msg.createdAt)}</span>
                    </div>
                  )}
                  <div className={`chat-bubble ${isDeleted ? 'deleted' : ''}`}>
                    {isDeleted ? <span className="chat-deleted-text">삭제된 메시지입니다.</span> : (
                      msg.type === 'image' && msg.imageUrl
                        ? <img src={msg.imageUrl} className="chat-image" alt="사진" onClick={() => setImageViewer(msg.imageUrl)} />
                        : msg.type === 'file' && msg.fileUrl
                          ? <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="chat-file-bubble">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" className="chat-file-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              <div className="chat-file-info">
                                <span className="chat-file-name">{msg.fileName}</span>
                                <span className="chat-file-size">{formatFileSize(msg.fileSize)}</span>
                              </div>
                            </a>
                          : <><span>{searchKeyword ? highlight(msg.text, searchKeyword) : msg.text}</span>{msg.editedAt && <span className="chat-edited-mark">수정됨</span>}</>
                    )}
                  </div>
                  {!mine && (
                    <div className="chat-meta-right">
                      <span className="chat-time">{formatTime(msg.createdAt)}</span>
                      {readerCount > 0 && <span className="chat-read-count">{readerCount}</span>}
                    </div>
                  )}
                </div>
                {msg.reactions && Object.entries(msg.reactions).filter(([, u]) => u?.length > 0).length > 0 && (
                  <div className={`chat-reactions ${mine ? 'mine' : ''}`}>
                    {Object.entries(msg.reactions).filter(([, u]) => u?.length > 0).map(([emoji, reactUsers]) => (
                      <button key={emoji} className={`chat-reaction-chip ${reactUsers.includes(userProfile?.uid) ? 'active' : ''}`}
                        onClick={() => handleReaction(msg, emoji)}>
                        {emoji} {reactUsers.length}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {typingUsers.length > 0 && (
          <div className="chat-typing">
            <span className="chat-typing-dots"><span/><span/><span/></span>
            {typingUsers.join(', ')}이 입력 중...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 컨텍스트 메뉴 */}
      {menuMsg && (
        <div className="chat-menu-overlay" onClick={() => setMenuMsg(null)}>
          <div className="chat-menu" onClick={(e) => e.stopPropagation()}>
            <div className="chat-menu-emojis">
              {EMOJIS.map((em) => (
                <button key={em} className="chat-menu-emoji" onClick={() => handleReaction(menuMsg, em)}>{em}</button>
              ))}
            </div>
            <button className="chat-menu-item" onClick={() => { setReplyTo({ id: menuMsg.id, userName: menuMsg.userName, text: menuMsg.text, type: menuMsg.type }); setMenuMsg(null); inputRef.current?.focus(); }}>답장</button>
            {isAdmin && (
              <button className="chat-menu-item" onClick={() => handlePin(menuMsg)}>
                {menuMsg.isPinned ? '고정 해제' : '공지 고정'}
              </button>
            )}
            {menuMsg.userId === userProfile?.uid && menuMsg.type === 'text' && !menuMsg.deletedAt && (
              <button className="chat-menu-item" onClick={() => { setEditingMsg(menuMsg); setText(menuMsg.text); setReplyTo(null); setMenuMsg(null); setTimeout(() => inputRef.current?.focus(), 50); }}>수정</button>
            )}
            {menuMsg.userId === userProfile?.uid && (
              <button className="chat-menu-item danger" onClick={() => handleDelete(menuMsg)}>삭제</button>
            )}
            <button className="chat-menu-item cancel" onClick={() => setMenuMsg(null)}>취소</button>
          </div>
        </div>
      )}

      {/* 이미지 뷰어 */}
      {imageViewer && (
        <div className="chat-image-viewer" onClick={() => setImageViewer(null)}>
          <img src={imageViewer} alt="사진" />
          <button className="chat-viewer-close" onClick={() => setImageViewer(null)}>✕</button>
        </div>
      )}

      {/* 입력 영역 */}
      <div className="chat-input-area">
        {editingMsg && (
          <div className="chat-edit-bar">
            <div className="chat-edit-bar-content">
              <span className="chat-edit-bar-label">메시지 수정 중</span>
              <span className="chat-edit-bar-text">{editingMsg.text}</span>
            </div>
            <button className="chat-edit-bar-close" onClick={() => { setEditingMsg(null); setText(''); }}>✕</button>
          </div>
        )}
        {!editingMsg && replyTo && (
          <div className="chat-reply-bar">
            <div className="chat-reply-bar-content">
              <span className="chat-reply-bar-name">{replyTo.userName}에게 답장</span>
              <span className="chat-reply-bar-text">{replyTo.type === 'image' ? '사진' : replyTo.type === 'file' ? `📎 ${replyTo.fileName || '파일'}` : replyTo.text}</span>
            </div>
            <button className="chat-reply-bar-close" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}
        {showMention && mentionFiltered.length > 0 && (
          <div className="chat-mention-list">
            {mentionFiltered.map((u) => (
              <button key={u.uid} className="chat-mention-item" onClick={() => insertMention(u)}>
                <span className="chat-mention-name">{u.name}</span>
                <span className="chat-mention-pos">{u.position || ''}</span>
              </button>
            ))}
          </div>
        )}
        <form className="chat-input-bar" onSubmit={handleSend}>
          <label className="chat-attach-btn" title="사진 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageSelect} />
          </label>
          <label className="chat-attach-btn" title="파일 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            <input type="file" accept="*/*" style={{ display: 'none' }} onChange={handleFileSelect} />
          </label>
          <input
            ref={inputRef}
            type="text"
            className="chat-input"
            placeholder="메시지 입력... (@로 멘션)"
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            autoComplete="off"
          />
          <button type="submit" className="chat-send-btn" disabled={!text.trim() || sending}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
