import { useState, useEffect, useRef } from 'react';
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';

const messagesRef = collection(db, 'chatMessages');

export default function ChatPage() {
  const { userProfile } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    const q = query(messagesRef, orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await addDoc(messagesRef, {
        userId: userProfile.uid,
        userName: userProfile.name,
        position: userProfile.position || '',
        text: trimmed,
        createdAt: serverTimestamp(),
      });
      setText('');
    } catch (err) {
      alert('전송 실패: ' + err.message);
    } finally {
      setSending(false);
    }
  }

  function formatTime(ts) {
    if (!ts?.seconds) return '';
    const d = new Date(ts.seconds * 1000);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function isMine(msg) {
    return msg.userId === userProfile?.uid;
  }

  let lastDate = '';

  return (
    <div className="chat-page">
      <div className="chat-messages">
        {messages.map((msg) => {
          const dateStr = msg.createdAt?.seconds
            ? new Date(msg.createdAt.seconds * 1000).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })
            : '';
          const showDate = dateStr && dateStr !== lastDate;
          if (showDate) lastDate = dateStr;
          const mine = isMine(msg);

          return (
            <div key={msg.id}>
              {showDate && (
                <div className="chat-date-divider"><span>{dateStr}</span></div>
              )}
              <div className={`chat-bubble-wrap ${mine ? 'mine' : 'theirs'}`}>
                {!mine && <div className="chat-sender">{msg.userName}{msg.position ? ` · ${msg.position}` : ''}</div>}
                <div className="chat-row">
                  {mine && <span className="chat-time">{formatTime(msg.createdAt)}</span>}
                  <div className="chat-bubble">{msg.text}</div>
                  {!mine && <span className="chat-time">{formatTime(msg.createdAt)}</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-bar" onSubmit={handleSend}>
        <input
          type="text"
          className="chat-input"
          placeholder="메시지 입력..."
          value={text}
          onChange={(e) => setText(e.target.value)}
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
  );
}
