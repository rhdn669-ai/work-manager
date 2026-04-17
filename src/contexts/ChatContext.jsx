import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from './AuthContext';

const ChatContext = createContext({ unreadCount: 0, markAsRead: () => {} });

const storageKey = (uid) => `chatLastRead_${uid}`;

export function ChatProvider({ children }) {
  const { userProfile } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const key = storageKey(userProfile.uid);
    const lastRead = parseInt(localStorage.getItem(key) || '0', 10);

    const q = query(collection(db, 'chatMessages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const count = snap.docs.filter((d) => {
        const data = d.data();
        const ts = data.createdAt?.seconds;
        return ts && ts * 1000 > lastRead && data.userId !== userProfile.uid;
      }).length;
      setUnreadCount(count);
    });
    return () => unsub();
  }, [userProfile?.uid]);

  const markAsRead = useCallback(() => {
    if (!userProfile?.uid) return;
    localStorage.setItem(storageKey(userProfile.uid), Date.now().toString());
    setUnreadCount(0);
  }, [userProfile?.uid]);

  return (
    <ChatContext.Provider value={{ unreadCount, markAsRead }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
