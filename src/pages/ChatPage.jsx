import { useState } from 'react';
import ChannelListPage from './ChannelListPage';
import ChannelChatPage from './ChannelChatPage';
import DmListPage from './DmListPage';

export default function ChatPage() {
  const [tab, setTab] = useState('group');
  const [activeChannel, setActiveChannel] = useState(null);

  if (tab === 'dm') {
    return <DmListPage onGoToGroup={() => { setTab('group'); setActiveChannel(null); }} />;
  }

  if (activeChannel) {
    return (
      <ChannelChatPage
        channel={activeChannel}
        onBack={() => setActiveChannel(null)}
        onGoToDm={() => setTab('dm')}
      />
    );
  }

  return (
    <ChannelListPage
      onSelectChannel={setActiveChannel}
      onGoToDm={() => setTab('dm')}
    />
  );
}
