import { useState, useCallback } from 'react';
import { ChatMessage } from '../types.js';

interface UseChatProps {
  currentUser: { userId: string; username: string; userColor: string; isModerator?: boolean };
  rawMessages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

export function useChat({ currentUser, rawMessages, onSendMessage }: UseChatProps) {
  const [mutedUsers, setMutedUsers] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('collab_muted_users');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('collab_blocked_users');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Mute / Unmute user
  const toggleMuteUser = useCallback((userId: string) => {
    setMutedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      localStorage.setItem('collab_muted_users', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  // Block / Unblock user
  const toggleBlockUser = useCallback((userId: string) => {
    setBlockedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      localStorage.setItem('collab_blocked_users', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  // Report user
  const submitReport = useCallback(
    async (
      reportedUserId: string,
      reportedUsername: string,
      reason: string,
      contextType: 'chat' | 'drawing',
      contextId?: string
    ) => {
      try {
        const res = await fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            report: {
              reporterId: currentUser.userId,
              reportedUserId,
              reportedUsername,
              reason,
              contextType,
              contextId,
            },
          }),
        });
        const data = await res.json();
        return data.success;
      } catch (e) {
        return false;
      }
    },
    [currentUser.userId]
  );

  // Filter messages based on muted and blocked lists
  const visibleMessages = rawMessages.filter(
    m => !mutedUsers.has(m.userId) && !blockedUsers.has(m.userId)
  );

  return {
    messages: visibleMessages,
    sendMessage: onSendMessage,
    mutedUsers,
    blockedUsers,
    toggleMuteUser,
    toggleBlockUser,
    submitReport,
  };
}
