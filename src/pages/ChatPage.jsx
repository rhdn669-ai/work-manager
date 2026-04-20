import { useState } from 'react';
import ChannelListPage from './ChannelListPage';
import ChannelChatPage from './ChannelChatPage';
import DmChatPage from './DmChatPage';

export default function ChatPage() {
  const [activeChannel, setActiveChannel] = useState(null);
  const [activeDm, setActiveDm] = useState(null);

  if (activeChannel) {
    return (
      <ChannelChatPage
        channel={activeChannel}
        onBack={() => setActiveChannel(null)}
      />
    );
  }

  if (activeDm) {
    return (
      <DmChatPage
        room={activeDm}
        onBack={() => setActiveDm(null)}
        onGoToGroup={() => setActiveDm(null)}
      />
    );
  }

  return (
    <ChannelListPage
      onSelectChannel={setActiveChannel}
      onSelectDm={setActiveDm}
    />
  );
}
