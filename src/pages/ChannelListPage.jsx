import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getAccessibleChannels, ensureCompanyChannel } from '../services/channelService';

export default function ChannelListPage({ onSelectChannel, onGoToDm }) {
  const { userProfile, canApproveAll } = useAuth();
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      await ensureCompanyChannel();
      const list = await getAccessibleChannels(userProfile.departmentId, canApproveAll);
      setChannels(list);
      setLoading(false);
    })();
  }, [userProfile?.uid, canApproveAll]);

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="channel-list-page">
      <div className="channel-list-header">
        <span className="channel-list-title">채팅</span>
        <button className="channel-dm-btn" onClick={onGoToDm}>1:1 채팅 →</button>
      </div>
      <div className="channel-list">
        {channels.map((ch) => (
          <button key={ch.id} className="channel-item" onClick={() => onSelectChannel(ch)}>
            <div className={`channel-icon-wrap ${ch.type === 'company' ? 'company' : 'dept'}`}>
              {ch.type === 'company' ? '전사' : '#'}
            </div>
            <div className="channel-info">
              <span className="channel-name">{ch.name}</span>
              <span className="channel-type-label">{ch.type === 'company' ? '전체 공지·대화' : '부서 채팅'}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="channel-arrow">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        ))}
        {channels.length === 0 && (
          <div className="channel-empty">접근 가능한 채팅방이 없습니다.</div>
        )}
      </div>
    </div>
  );
}
