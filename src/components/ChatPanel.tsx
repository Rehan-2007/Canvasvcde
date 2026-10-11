import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare,
  Users,
  Send,
  MoreVertical,
  VolumeX,
  Volume2,
  Ban,
  Flag,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { ChatMessage, OnlineUser } from '../types.js';

interface ChatPanelProps {
  currentUser: { userId: string; username: string; userColor: string; isModerator?: boolean };
  messages: ChatMessage[];
  onlineUsers: OnlineUser[];
  mutedUsers: Set<string>;
  blockedUsers: Set<string>;
  onSendMessage: (text: string) => void;
  onToggleMute: (userId: string) => void;
  onToggleBlock: (userId: string) => void;
  onOpenReport: (user: { userId: string; username: string }, contextId?: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}

export function ChatPanel({
  currentUser,
  messages,
  onlineUsers,
  mutedUsers,
  blockedUsers,
  onSendMessage,
  onToggleMute,
  onToggleBlock,
  onOpenReport,
  isOpen,
  onToggleOpen,
}: ChatPanelProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'users'>('chat');
  const [inputText, setInputText] = useState('');
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'chat' && isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeTab, isOpen]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggleOpen}
        title="Open Chat & Users"
        className="fixed top-16 right-3 z-40 p-2.5 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-xl shadow-2xl backdrop-blur-md transition-all flex items-center gap-2"
      >
        <MessageSquare className="w-4 h-4" />
        <span className="text-xs font-medium hidden sm:inline">Chat</span>
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      </button>
    );
  }

  return (
    <aside
      aria-label="Live Chat and Users"
      className="fixed top-14 bottom-3 right-3 z-40 w-80 sm:w-88 bg-zinc-900/95 backdrop-blur-lg border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200 transition-all"
    >
      {/* Header & Tabs */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800 bg-zinc-950/40">
        <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-xs">
          <button
            onClick={() => setActiveTab('chat')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
              activeTab === 'chat'
                ? 'bg-zinc-800 text-zinc-100 font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
            {messages.length > 0 && (
              <span className="text-[10px] text-zinc-400">({messages.length})</span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
              activeTab === 'users'
                ? 'bg-zinc-800 text-zinc-100 font-medium shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Online</span>
            <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-zinc-800 text-emerald-400 border border-zinc-700/50">
              {onlineUsers.length}
            </span>
          </button>
        </div>

        <button
          onClick={onToggleOpen}
          title="Collapse Panel"
          className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tab: Chat */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-thin scrollbar-thumb-zinc-700">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500">
                <MessageSquare className="w-8 h-8 mb-2 stroke-1 opacity-50" />
                <p className="text-xs font-medium text-zinc-400">No messages yet</p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Say hello to other artists drawing with you!
                </p>
              </div>
            ) : (
              messages.map(msg => {
                const isMe = msg.userId === currentUser.userId;
                return (
                  <div
                    key={msg.id}
                    className="group relative flex flex-col gap-0.5 rounded-lg p-2 hover:bg-zinc-800/40 transition-colors"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ backgroundColor: msg.userColor }}
                        />
                        <span
                          className="font-medium truncate max-w-[130px]"
                          style={{ color: msg.userColor }}
                        >
                          {msg.username}
                        </span>
                        {isMe && (
                          <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400">
                            you
                          </span>
                        )}
                        {msg.isModerator && (
                          <span className="flex items-center gap-0.5 text-[9px] px-1 rounded bg-amber-500/20 text-amber-400 font-medium border border-amber-500/30">
                            <ShieldCheck className="w-2.5 h-2.5" /> Mod
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <span>{formatTime(msg.createdAt)}</span>

                        {!isMe && (
                          <div className="relative">
                            <button
                              onClick={() =>
                                setActiveActionMenu(
                                  activeActionMenu === msg.id ? null : msg.id
                                )
                              }
                              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-zinc-200 transition-opacity"
                            >
                              <MoreVertical className="w-3 h-3" />
                            </button>

                            {activeActionMenu === msg.id && (
                              <div
                                className="absolute right-0 top-full mt-1 bg-zinc-950 border border-zinc-700 rounded-lg shadow-2xl p-1 z-50 min-w-[110px]"
                                onMouseLeave={() => setActiveActionMenu(null)}
                              >
                                <button
                                  onClick={() => {
                                    onToggleMute(msg.userId);
                                    setActiveActionMenu(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 rounded"
                                >
                                  {mutedUsers.has(msg.userId) ? (
                                    <>
                                      <Volume2 className="w-3 h-3 text-emerald-400" /> Unmute
                                    </>
                                  ) : (
                                    <>
                                      <VolumeX className="w-3 h-3 text-amber-400" /> Mute
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={() => {
                                    onToggleBlock(msg.userId);
                                    setActiveActionMenu(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-red-400 hover:bg-zinc-800 rounded"
                                >
                                  <Ban className="w-3 h-3" /> Block
                                </button>
                                <button
                                  onClick={() => {
                                    onOpenReport(
                                      { userId: msg.userId, username: msg.username },
                                      msg.id
                                    );
                                    setActiveActionMenu(null);
                                  }}
                                  className="w-full flex items-center gap-2 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 rounded"
                                >
                                  <Flag className="w-3 h-3" /> Report
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-zinc-300 break-words leading-relaxed pl-3.5">
                      {msg.text}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input */}
          <form onSubmit={handleSend} className="p-2.5 border-t border-zinc-800 bg-zinc-950/60">
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                maxLength={300}
                placeholder="Message public room..."
                className="w-full bg-zinc-900 text-zinc-100 text-xs pl-3 pr-8 py-2 rounded-lg border border-zinc-750 focus:outline-none focus:border-zinc-500 placeholder-zinc-500"
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="absolute right-1.5 p-1 rounded-md text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex justify-between items-center text-[10px] text-zinc-500 px-1 mt-1">
              <span>Enter to send</span>
              <span>{inputText.length}/300</span>
            </div>
          </form>
        </div>
      )}

      {/* Tab: Online Users */}
      {activeTab === 'users' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-700">
          <div className="text-[10px] font-semibold text-zinc-500 uppercase px-2 mb-1 tracking-wider">
            Connected Artists ({onlineUsers.length})
          </div>

          {onlineUsers.map(user => {
            const isMe = user.userId === currentUser.userId;
            const isMuted = mutedUsers.has(user.userId);
            const isBlocked = blockedUsers.has(user.userId);

            return (
              <div
                key={user.userId}
                className="flex items-center justify-between p-2 rounded-lg bg-zinc-900/60 hover:bg-zinc-800/50 border border-zinc-800/80 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[11px] text-zinc-950 flex-shrink-0"
                    style={{ backgroundColor: user.userColor }}
                  >
                    {user.username.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-200 truncate">
                        {user.username}
                      </span>
                      {isMe && (
                        <span className="text-[9px] px-1 rounded bg-zinc-800 text-zinc-400 font-mono">
                          you
                        </span>
                      )}
                      {user.isModerator && (
                        <span className="text-[9px] text-amber-400 flex items-center">
                          <ShieldCheck className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {isBlocked ? (
                        <span className="text-red-400">Blocked</span>
                      ) : isMuted ? (
                        <span className="text-amber-400">Muted</span>
                      ) : (
                        <span className="text-emerald-500">Online</span>
                      )}
                    </div>
                  </div>
                </div>

                {!isMe && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onToggleMute(user.userId)}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      className={`p-1.5 rounded-md text-xs transition-colors ${
                        isMuted
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => onToggleBlock(user.userId)}
                      title={isBlocked ? 'Unblock' : 'Block'}
                      className={`p-1.5 rounded-md text-xs transition-colors ${
                        isBlocked
                          ? 'bg-red-500/20 text-red-400'
                          : 'text-zinc-400 hover:text-red-400 hover:bg-zinc-800'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onOpenReport({ userId: user.userId, username: user.username })}
                      title="Report"
                      className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                    >
                      <Flag className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
