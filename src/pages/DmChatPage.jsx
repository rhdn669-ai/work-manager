import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useChat } from '../contexts/ChatContext';
import {
  subscribeDmMessages, sendDmMessage, sendDmImage, sendDmFile,
  deleteDmMessage, toggleDmReaction, editDmMessage,
} from '../services/chatService';

const EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(ts) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function formatDate(ts) {
  if (!ts?.seconds) return '';
  return new Date(ts.seconds * 1000).toLocaleDateString('ko-KR', { month:'long', day:'numeric', weekday:'short' });
}

export default function DmChatPage({ room, onBack, onGoToGroup, onGoToDm }) {
  const { userProfile } = useAuth();
  const { markAsRead } = useChat();

  // DM 입장 시 읽음 처리 (사이드바/바텀바 배지용)
  useEffect(() => {
    if (room?.roomId) markAsRead('dm', room.roomId);
  }, [room?.roomId, markAsRead]);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [menuMsg, setMenuMsg] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const msgRefs = useRef({});
  const [flashMsgId, setFlashMsgId] = useState(null);
  function jumpToMessage(id) {
    if (!id) return;
    const el = msgRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashMsgId(id);
    setTimeout(() => setFlashMsgId((cur) => (cur === id ? null : cur)), 1200);
  }

  useEffect(() => {
    const unsub = subscribeDmMessages(room.roomId, (msgs) => {
      setMessages(msgs);
      // 방에 머무르는 동안 새 메시지 수신 → 배지 카운트 동기화
      if (room?.roomId) markAsRead('dm', room.roomId);
    });
    return () => unsub();
  }, [room.roomId, markAsRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      if (editingMsg) {
        await editDmMessage(room.roomId, editingMsg.id, trimmed);
        setEditingMsg(null);
      } else {
        await sendDmMessage({ roomId: room.roomId, userId: userProfile.uid, userName: userProfile.name, position: userProfile.position || '', text: trimmed, replyTo });
        setReplyTo(null);
      }
      setText('');
    } catch (err) { alert('전송 실패: ' + err.message); }
    finally { setSending(false); }
  }

  async function handleImageSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    try {
      await sendDmImage({ roomId: room.roomId, userId: userProfile.uid, userName: userProfile.name, position: userProfile.position || '', file, replyTo });
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
      await sendDmFile({ roomId: room.roomId, userId: userProfile.uid, userName: userProfile.name, position: userProfile.position || '', file, replyTo });
      setReplyTo(null);
    } catch (err) { alert('파일 전송 실패: ' + err.message); }
    finally { setSending(false); e.target.value = ''; }
  }

  async function handleDelete(msg) {
    if (!window.confirm('메시지를 삭제할까요?')) return;
    // 낙관적 업데이트 — Firestore 라운드트립 대기 없이 UI 즉시 반영
    setMessages((prev) => prev.map((m) =>
      m.id === msg.id
        ? { ...m, deletedAt: { seconds: Math.floor(Date.now() / 1000) }, text: '삭제된 메시지입니다.', imageUrl: null, fileUrl: null, fileName: null }
        : m
    ));
    setMenuMsg(null);
    try {
      await deleteDmMessage(room.roomId, msg.id);
    } catch (err) {
      alert('삭제 실패: ' + err.message);
      // 실패 시 원상복구 (snapshot에서 재동기화도 되지만 즉시 되돌리기 위해)
      setMessages((prev) => prev.map((m) => m.id === msg.id ? msg : m));
    }
  }

  async function handleReaction(msg, emoji) {
    await toggleDmReaction(room.roomId, msg.id, emoji, userProfile.uid);
    setMenuMsg(null);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  let lastDate = '';

  return (
    <div className="chat-page dm-chat-page">
      <div className="dm-chat-header">
        <button className="dm-back-btn" onClick={onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span className="dm-chat-title">{room.otherName}</span>
        {(onGoToGroup || onGoToDm) && (
          <button className="dm-group-btn" onClick={onGoToGroup || onGoToDm} title="채팅 목록으로">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </button>
        )}
      </div>

      <div className="chat-messages" onClick={() => setMenuMsg(null)}>
        {messages.map((msg) => {
          const dateStr = formatDate(msg.createdAt);
          const showDate = dateStr && dateStr !== lastDate;
          if (showDate) lastDate = dateStr;
          const mine = msg.userId === userProfile?.uid;
          const isDeleted = !!msg.deletedAt;
          const readerCount = msg.readBy ? Object.keys(msg.readBy).length - 1 : 0;
          const isMentioned = !mine && !isDeleted && userProfile?.name && typeof msg.text === 'string' && msg.text.includes(`@${userProfile.name}`);
          const isFlashed = flashMsgId === msg.id;

          return (
            <div key={msg.id} ref={(el) => { if (el) msgRefs.current[msg.id] = el; }}>
              {showDate && <div className="chat-date-divider"><span>{dateStr}</span></div>}
              <div
                className={`chat-bubble-wrap ${mine ? 'mine' : 'theirs'} ${isMentioned ? 'is-mentioned' : ''} ${isFlashed ? 'is-flashed' : ''}`}
                onContextMenu={(e) => { e.preventDefault(); if (!isDeleted) setMenuMsg(msg); }}
                onPointerDown={(e) => {
                  if (e.pointerType !== 'touch') return;
                  const t = setTimeout(() => { if (!isDeleted) setMenuMsg(msg); }, 500);
                  const cancel = () => { clearTimeout(t); e.target.removeEventListener('pointerup', cancel); };
                  e.target.addEventListener('pointerup', cancel);
                }}
              >
                {msg.replyTo && (
                  <button
                    type="button"
                    className="chat-reply-preview"
                    onClick={() => jumpToMessage(msg.replyTo.id)}
                    title="원본 메시지로 이동"
                  >
                    <span className="chat-reply-name">{msg.replyTo.userName}</span>
                    <span>{msg.replyTo.type === 'image' ? '사진' : msg.replyTo.type === 'file' ? `📎 ${msg.replyTo.fileName || '파일'}` : msg.replyTo.text}</span>
                  </button>
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
                          : <><span>{msg.text}</span>{msg.editedAt && <span className="chat-edited-mark">수정됨</span>}</>
                    )}
                  </div>
                  {!mine && (
                    <div className="chat-meta-right">
                      <span className="chat-time">{formatTime(msg.createdAt)}</span>
                      {readerCount > 0 && <span className="chat-read-count">{readerCount}</span>}
                    </div>
                  )}
                </div>
                {msg.reactions && Object.keys(msg.reactions).filter((e) => msg.reactions[e]?.length > 0).length > 0 && (
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
        <div ref={bottomRef} />
      </div>

      {menuMsg && (
        <div className="chat-menu-overlay" onClick={() => setMenuMsg(null)}>
          <div className="chat-menu" onClick={(e) => e.stopPropagation()}>
            <div className="chat-menu-emojis">
              {EMOJIS.map((em) => (
                <button key={em} className="chat-menu-emoji" onClick={() => handleReaction(menuMsg, em)}>{em}</button>
              ))}
            </div>
            <button className="chat-menu-item" onClick={() => { setReplyTo({ id: menuMsg.id, userName: menuMsg.userName, text: menuMsg.text, type: menuMsg.type }); setMenuMsg(null); inputRef.current?.focus(); }}>답장</button>
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

      {imageViewer && (
        <div className="chat-image-viewer" onClick={() => setImageViewer(null)}>
          <img src={imageViewer} alt="사진" />
          <button className="chat-viewer-close" onClick={() => setImageViewer(null)}>✕</button>
        </div>
      )}

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
              <span className="chat-reply-bar-text">{replyTo.type === 'image' ? '사진' : replyTo.text}</span>
            </div>
            <button className="chat-reply-bar-close" onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}
        <form className="chat-input-bar" onSubmit={handleSend}>
          <label className="chat-attach-btn" title="사진 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            <input type="file" accept="image/*" style={{display:'none'}} onChange={handleImageSelect} />
          </label>
          <label className="chat-attach-btn" title="파일 첨부">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            <input type="file" accept="*/*" style={{display:'none'}} onChange={handleFileSelect} />
          </label>
          <input ref={inputRef} type="text" className="chat-input" placeholder="메시지 입력..." value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={handleKeyDown} autoComplete="off" />
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
