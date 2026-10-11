import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Stroke,
  ChatMessage,
  RemoteCursor,
  OnlineUser,
  CanvasSnapshot,
  ConnectionStatus,
  WSServerMessage,
  WSClientMessage,
  ToolType,
} from '../types.js';
import { getSupabaseClient, getStoredSupabaseConfig } from '../lib/supabase.js';

interface UseRealtimeCanvasProps {
  currentUser: { userId: string; username: string; userColor: string; isModerator?: boolean };
  onRateLimitWarning?: (msg: string) => void;
  onCanvasClearedNotification?: (modName: string) => void;
}

export function useRealtimeCanvas({
  currentUser,
  onRateLimitWarning,
  onCanvasClearedNotification,
}: UseRealtimeCanvasProps) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    state: 'connecting',
    transport: 'websocket',
  });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Map<string, RemoteCursor>>(new Map());
  const [liveRemoteStrokes, setLiveRemoteStrokes] = useState<Map<string, Partial<Stroke>>>(new Map());

  // Stroke history stacks for undo/redo
  const [myUndoStack, setMyUndoStack] = useState<string[]>([]);
  const [myRedoStack, setMyRedoStack] = useState<string[]>([]);

  // Stable references to prevent infinite re-render loops
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const onRateLimitWarningRef = useRef(onRateLimitWarning);
  onRateLimitWarningRef.current = onRateLimitWarning;
  const onCanvasClearedNotificationRef = useRef(onCanvasClearedNotification);
  onCanvasClearedNotificationRef.current = onCanvasClearedNotification;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const knownStrokeIds = useRef<Set<string>>(new Set());
  const pendingBuffer = useRef<Stroke[]>([]);
  const isMountedRef = useRef(true);

  // References for peer synchronization
  const strokesRef = useRef<Stroke[]>([]);
  strokesRef.current = strokes;
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  chatMessagesRef.current = chatMessages;
  const supabaseChannelRef = useRef<any>(null);

  // Throttled cursor broadcast
  const lastCursorEmitTime = useRef(0);

  // Connect to WebSocket Server
  const connectWs = useCallback(() => {
    if (!isMountedRef.current) return;

    // Clean up any stale listeners on previous connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      setConnectionStatus(prev => prev.state === 'connecting' ? prev : { ...prev, state: 'connecting' });

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setConnectionStatus({ state: 'connected', transport: 'websocket' });

        // Send Join message
        const joinMsg: WSClientMessage = {
          type: 'join',
          user: currentUserRef.current,
        };
        ws.send(JSON.stringify(joinMsg));

        // Flush pending buffer if any
        if (pendingBuffer.current.length > 0) {
          pendingBuffer.current.forEach(stroke => {
            ws.send(JSON.stringify({ type: 'stroke:commit', stroke }));
          });
          pendingBuffer.current = [];
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSServerMessage;

          switch (msg.type) {
            case 'init': {
              if (msg.snapshot) {
                setSnapshot(msg.snapshot);
              }
              const validStrokes = msg.strokes || [];
              validStrokes.forEach(s => knownStrokeIds.current.add(s.id));
              setStrokes(validStrokes);
              setOnlineUsers(msg.users || []);
              if (msg.chatMessages) {
                setChatMessages(msg.chatMessages);
              }

              // Restore user's own undo stack
              const myOwn = validStrokes
                .filter(s => s.userId === currentUserRef.current.userId && !s.isUndone)
                .map(s => s.id);
              setMyUndoStack(myOwn);
              break;
            }

            case 'user:joined': {
              setOnlineUsers(prev => {
                const filtered = prev.filter(u => u.userId !== msg.user.userId);
                return [...filtered, msg.user];
              });
              break;
            }

            case 'user:left': {
              setOnlineUsers(prev => prev.filter(u => u.userId !== msg.userId));
              setRemoteCursors(prev => {
                const next = new Map(prev);
                next.delete(msg.userId);
                return next;
              });
              setLiveRemoteStrokes(prev => {
                const next = new Map(prev);
                next.delete(msg.userId);
                return next;
              });
              break;
            }

            case 'cursor:update': {
              if (msg.cursor.userId === currentUserRef.current.userId) return;
              setRemoteCursors(prev => {
                const next = new Map(prev);
                next.set(msg.cursor.userId, msg.cursor);
                return next;
              });
              break;
            }

            case 'stroke:live': {
              if (msg.stroke.userId === currentUserRef.current.userId) return;
              setLiveRemoteStrokes(prev => {
                const next = new Map(prev);
                if (msg.stroke.userId) {
                  next.set(msg.stroke.userId, msg.stroke);
                }
                return next;
              });
              break;
            }

            case 'stroke:commit': {
              const stroke = msg.stroke;
              // Remove live preview for this user
              if (stroke.userId) {
                setLiveRemoteStrokes(prev => {
                  const next = new Map(prev);
                  next.delete(stroke.userId);
                  return next;
                });
              }

              if (knownStrokeIds.current.has(stroke.id)) return;
              knownStrokeIds.current.add(stroke.id);

              setStrokes(prev => [...prev, stroke]);
              break;
            }

            case 'stroke:undo': {
              setStrokes(prev =>
                prev.map(s => (s.id === msg.strokeId ? { ...s, isUndone: true } : s))
              );
              break;
            }

            case 'stroke:redo': {
              const stroke = msg.stroke;
              setStrokes(prev => {
                const index = prev.findIndex(s => s.id === stroke.id);
                if (index >= 0) {
                  const updated = [...prev];
                  updated[index] = { ...stroke, isUndone: false };
                  return updated;
                }
                return [...prev, stroke];
              });
              break;
            }

            case 'canvas:cleared': {
              knownStrokeIds.current.clear();
              setStrokes([]);
              setSnapshot(null);
              setLiveRemoteStrokes(new Map());
              setMyUndoStack([]);
              setMyRedoStack([]);
              if (onCanvasClearedNotificationRef.current) {
                onCanvasClearedNotificationRef.current(msg.moderatorUsername);
              }
              break;
            }

            case 'chat:message': {
              const incoming = msg.message;
              setChatMessages(prev => {
                if (prev.some(m => m.id === incoming.id)) return prev;
                return [...prev.slice(-100), incoming];
              });
              break;
            }

            case 'snapshot:saved': {
              setSnapshot(msg.snapshot);
              break;
            }

            case 'rate_limit': {
              if (onRateLimitWarningRef.current) {
                onRateLimitWarningRef.current(msg.message);
              }
              break;
            }
          }
        } catch (err) {
          console.error('[CollabCanvas] Error handling message:', err);
        }
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        setConnectionStatus(prev => prev.state === 'reconnecting' ? prev : { ...prev, state: 'reconnecting' });
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectWs, 3000);
      };

      ws.onerror = (err) => {
        console.warn('[CollabCanvas] WebSocket connection note:', err);
      };
    } catch (e) {
      console.error('[CollabCanvas] WebSocket connection failed:', e);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connectWs, 4000);
    }
  }, []); // Empty dependencies ensure stable connection function!

  // Connect on mount
  useEffect(() => {
    isMountedRef.current = true;
    connectWs();

    // Clean stale cursors every 5 seconds
    const cursorInterval = setInterval(() => {
      const now = Date.now();
      setRemoteCursors(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [uid, cursor] of next.entries()) {
          if (now - cursor.lastActive > 8000) {
            next.delete(uid);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 4000);

    return () => {
      isMountedRef.current = false;
      clearInterval(cursorInterval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  // Global Supabase Realtime Broadcast & Presence Integration (Bridges all devices worldwide)
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let channel: any = null;
    try {
      channel = supabase.channel('collabcanvas-global-room', {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: currentUser.userId },
        },
      });
      supabaseChannelRef.current = channel;

      // 1. Receive committed strokes from other devices
      channel.on('broadcast', { event: 'stroke:commit' }, (payload: any) => {
        const stroke = payload.payload?.stroke as Stroke;
        if (!stroke || knownStrokeIds.current.has(stroke.id)) return;
        knownStrokeIds.current.add(stroke.id);
        setStrokes(prev => [...prev, stroke]);

        if (stroke.userId) {
          setLiveRemoteStrokes(prev => {
            const next = new Map(prev);
            next.delete(stroke.userId);
            return next;
          });
        }
      });

      // 2. Receive live in-progress strokes
      channel.on('broadcast', { event: 'stroke:live' }, (payload: any) => {
        const stroke = payload.payload?.stroke as Partial<Stroke> & { id: string };
        if (!stroke || stroke.userId === currentUser.userId) return;
        setLiveRemoteStrokes(prev => {
          const next = new Map(prev);
          if (stroke.userId) next.set(stroke.userId, stroke);
          return next;
        });
      });

      // 3. Receive remote cursors
      channel.on('broadcast', { event: 'cursor:move' }, (payload: any) => {
        const cursor = payload.payload?.cursor as RemoteCursor;
        if (!cursor || cursor.userId === currentUser.userId) return;
        setRemoteCursors(prev => {
          const next = new Map(prev);
          next.set(cursor.userId, cursor);
          return next;
        });
      });

      // 4. Undo and Redo from remote devices
      channel.on('broadcast', { event: 'stroke:undo' }, (payload: any) => {
        const { strokeId } = payload.payload || {};
        if (strokeId) {
          setStrokes(prev => prev.map(s => (s.id === strokeId ? { ...s, isUndone: true } : s)));
        }
      });

      channel.on('broadcast', { event: 'stroke:redo' }, (payload: any) => {
        const { strokeId } = payload.payload || {};
        if (strokeId) {
          setStrokes(prev => prev.map(s => (s.id === strokeId ? { ...s, isUndone: false } : s)));
        }
      });

      // 5. Canvas Clear
      channel.on('broadcast', { event: 'canvas:clear' }, (payload: any) => {
        knownStrokeIds.current.clear();
        setStrokes([]);
        setSnapshot(null);
        setLiveRemoteStrokes(new Map());
        setMyUndoStack([]);
        setMyRedoStack([]);
        if (onCanvasClearedNotification) {
          onCanvasClearedNotification(payload.payload?.username || 'Artist');
        }
      });

      // 6. Live Chat Messages
      channel.on('broadcast', { event: 'chat:message' }, (payload: any) => {
        const msg = payload.payload?.message as ChatMessage;
        if (!msg) return;
        setChatMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev.slice(-100), msg];
        });
      });

      // 7. Initial Canvas Synchronization between devices!
      // When a new device joins, it asks existing devices for current artwork
      channel.on('broadcast', { event: 'canvas:request_sync' }, (payload: any) => {
        const targetUserId = payload.payload?.userId;
        if (!targetUserId || targetUserId === currentUser.userId) return;
        const currentValidStrokes = strokesRef.current.filter(s => !s.isUndone);
        if (currentValidStrokes.length > 0) {
          channel.send({
            type: 'broadcast',
            event: 'canvas:sync_response',
            payload: {
              targetUserId,
              strokes: currentValidStrokes,
              chatMessages: chatMessagesRef.current.slice(-30),
            },
          });
        }
      });

      channel.on('broadcast', { event: 'canvas:sync_response' }, (payload: any) => {
        const { targetUserId, strokes: receivedStrokes, chatMessages: receivedChat } = payload.payload || {};
        if (targetUserId === currentUser.userId && Array.isArray(receivedStrokes)) {
          receivedStrokes.forEach((s: Stroke) => {
            knownStrokeIds.current.add(s.id);
          });
          setStrokes(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newStrokes = receivedStrokes.filter((s: Stroke) => !existingIds.has(s.id));
            return [...prev, ...newStrokes];
          });
          if (Array.isArray(receivedChat)) {
            setChatMessages(prev => {
              const existingIds = new Set(prev.map(p => p.id));
              const newChat = receivedChat.filter((c: ChatMessage) => !existingIds.has(c.id));
              return [...prev, ...newChat];
            });
          }
        }
      });

      // 8. Presence tracking across all devices
      channel.on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const online: OnlineUser[] = [];
        Object.values(presenceState).forEach((presences: any) => {
          presences.forEach((p: any) => {
            if (p.userId && !online.some(u => u.userId === p.userId)) {
              online.push({
                userId: p.userId,
                username: p.username || 'Artist',
                userColor: p.userColor || '#38bdf8',
                joinedAt: p.joinedAt || Date.now(),
              });
            }
          });
        });
        if (online.length > 0) {
          setOnlineUsers(online);
        }
      });

      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus({ state: 'connected', transport: 'supabase' });
          channel.track({
            userId: currentUserRef.current.userId,
            username: currentUserRef.current.username,
            userColor: currentUserRef.current.userColor,
            joinedAt: Date.now(),
          });
          // Request existing drawings from any device already online
          channel.send({
            type: 'broadcast',
            event: 'canvas:request_sync',
            payload: { userId: currentUserRef.current.userId },
          });
        }
      });
    } catch (err) {
      console.warn('[CollabCanvas] Supabase channel error:', err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        supabaseChannelRef.current = null;
      }
    };
  }, []);

  // Broadcast cursor movements throttled (max 30 times/sec)
  const broadcastCursor = useCallback(
    (x: number, y: number, tool: ToolType, isDrawing: boolean) => {
      const now = Date.now();
      if (now - lastCursorEmitTime.current < 33) return;
      lastCursorEmitTime.current = now;

      // 1. Broadcast to all devices via Supabase
      if (supabaseChannelRef.current) {
        supabaseChannelRef.current.send({
          type: 'broadcast',
          event: 'cursor:move',
          payload: {
            cursor: {
              userId: currentUser.userId,
              username: currentUser.username,
              userColor: currentUser.userColor,
              x,
              y,
              tool,
              isDrawing,
              lastActive: now,
            },
          },
        });
      }

      // 2. Broadcast via local WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'cursor:move',
          cursor: { x, y, tool, isDrawing },
        };
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [currentUser]
  );

  // Broadcast live in-progress stroke points
  const broadcastLiveStroke = useCallback(
    (liveStroke: Partial<Stroke> & { id: string }) => {
      const payloadStroke = {
        ...liveStroke,
        userId: currentUser.userId,
        username: currentUser.username,
      };

      // 1. Broadcast to all devices via Supabase
      if (supabaseChannelRef.current) {
        supabaseChannelRef.current.send({
          type: 'broadcast',
          event: 'stroke:live',
          payload: { stroke: payloadStroke },
        });
      }

      // 2. Broadcast via local WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'stroke:live',
          stroke: payloadStroke,
        };
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    [currentUser]
  );

  // Commit a completed stroke
  const commitStroke = useCallback(
    (stroke: Stroke) => {
      knownStrokeIds.current.add(stroke.id);
      // Optimistic local update
      setStrokes(prev => [...prev, stroke]);
      setMyUndoStack(prev => [...prev, stroke.id]);
      setMyRedoStack([]); // Clear redo stack on new action

      // 1. Broadcast to ALL devices worldwide via Supabase Realtime!
      if (supabaseChannelRef.current) {
        supabaseChannelRef.current.send({
          type: 'broadcast',
          event: 'stroke:commit',
          payload: { stroke },
        });
      }

      // 2. Send via local WebSocket for server persistence
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = { type: 'stroke:commit', stroke };
        wsRef.current.send(JSON.stringify(msg));
      } else {
        pendingBuffer.current.push(stroke);
      }
    },
    []
  );

  // Undo own recent stroke
  const undo = useCallback(() => {
    if (myUndoStack.length === 0) return;
    const strokeIdToUndo = myUndoStack[myUndoStack.length - 1];

    setMyUndoStack(prev => prev.slice(0, -1));
    setMyRedoStack(prev => [...prev, strokeIdToUndo]);

    // Optimistic local update
    setStrokes(prev =>
      prev.map(s => (s.id === strokeIdToUndo ? { ...s, isUndone: true } : s))
    );

    // 1. Broadcast to all devices via Supabase
    if (supabaseChannelRef.current) {
      supabaseChannelRef.current.send({
        type: 'broadcast',
        event: 'stroke:undo',
        payload: { strokeId: strokeIdToUndo, userId: currentUser.userId },
      });
    }

    // 2. Send to local WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:undo',
        strokeId: strokeIdToUndo,
        userId: currentUser.userId,
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, [myUndoStack, currentUser.userId]);

  // Redo own stroke
  const redo = useCallback(() => {
    if (myRedoStack.length === 0) return;
    const strokeIdToRedo = myRedoStack[myRedoStack.length - 1];

    setMyRedoStack(prev => prev.slice(0, -1));
    setMyUndoStack(prev => [...prev, strokeIdToRedo]);

    // Optimistic local update
    setStrokes(prev =>
      prev.map(s => (s.id === strokeIdToRedo ? { ...s, isUndone: false } : s))
    );

    // 1. Broadcast to all devices via Supabase
    if (supabaseChannelRef.current) {
      supabaseChannelRef.current.send({
        type: 'broadcast',
        event: 'stroke:redo',
        payload: { strokeId: strokeIdToRedo, userId: currentUser.userId },
      });
    }

    // 2. Send to local WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:redo',
        strokeId: strokeIdToRedo,
        userId: currentUser.userId,
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, [myRedoStack, currentUser.userId]);

  // Send live chat message
  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Optimistic instant display (0ms latency!)
      const localMsg: ChatMessage = {
        id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        userId: currentUser.userId,
        username: currentUser.username,
        userColor: currentUser.userColor,
        text: trimmed,
        isModerator: currentUser.isModerator,
        createdAt: Date.now(),
      };

      setChatMessages(prev => [...prev.slice(-100), localMsg]);

      // 1. Broadcast to all devices via Supabase
      if (supabaseChannelRef.current) {
        supabaseChannelRef.current.send({
          type: 'broadcast',
          event: 'chat:message',
          payload: { message: localMsg },
        });
      }

      // 2. Send to local WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const clientMsg: WSClientMessage = {
          type: 'chat:message',
          message: { text: trimmed },
        };
        wsRef.current.send(JSON.stringify(clientMsg));
      }
    },
    [currentUser]
  );

  // Instant clear canvas
  const clearCanvas = useCallback(
    async (): Promise<{ success: boolean; message: string }> => {
      // 1. Optimistic instant local wipe (0ms delay)
      knownStrokeIds.current.clear();
      setStrokes([]);
      setSnapshot(null);
      setLiveRemoteStrokes(new Map());
      setMyUndoStack([]);
      setMyRedoStack([]);

      // 2. Broadcast to all devices via Supabase
      if (supabaseChannelRef.current) {
        supabaseChannelRef.current.send({
          type: 'broadcast',
          event: 'canvas:clear',
          payload: { username: currentUser.username },
        });
      }

      // 3. Broadcast immediately over WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'canvas:clear',
          passcode: '',
          userId: currentUser.userId,
        };
        wsRef.current.send(JSON.stringify(msg));
      }

      // 4. Notify server endpoint
      try {
        fetch('/api/moderator/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUser.username }),
        }).catch(() => {});
      } catch (err) {
        // ignore
      }

      return { success: true, message: 'Canvas cleared' };
    },
    [currentUser]
  );

  // Save canvas snapshot
  const saveSnapshot = useCallback((dataUrl: string, strokeCount: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'snapshot:create',
        dataUrl,
        strokeCount,
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return {
    connectionStatus,
    strokes,
    snapshot,
    onlineUsers,
    chatMessages,
    remoteCursors,
    liveRemoteStrokes,
    myUndoStack,
    myRedoStack,
    broadcastCursor,
    broadcastLiveStroke,
    commitStroke,
    sendChatMessage,
    undo,
    redo,
    clearCanvas,
    saveSnapshot,
  };
}
