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

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const knownStrokeIds = useRef<Set<string>>(new Set());
  const pendingBuffer = useRef<Stroke[]>([]);
  const isMountedRef = useRef(true);

  // Throttled cursor broadcast
  const lastCursorEmitTime = useRef(0);

  // Connect to WebSocket Server
  const connectWs = useCallback(() => {
    if (!isMountedRef.current) return;

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      setConnectionStatus(prev => ({ ...prev, state: 'connecting' }));

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setConnectionStatus({ state: 'connected', transport: 'websocket' });

        // Send Join message
        const joinMsg: WSClientMessage = {
          type: 'join',
          user: currentUser,
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
                .filter(s => s.userId === currentUser.userId && !s.isUndone)
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
              if (msg.cursor.userId === currentUser.userId) return;
              setRemoteCursors(prev => {
                const next = new Map(prev);
                next.set(msg.cursor.userId, msg.cursor);
                return next;
              });
              break;
            }

            case 'stroke:live': {
              if (msg.stroke.userId === currentUser.userId) return;
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
              if (onCanvasClearedNotification) {
                onCanvasClearedNotification(msg.moderatorUsername);
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
              if (onRateLimitWarning) {
                onRateLimitWarning(msg.message);
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
        setConnectionStatus(prev => ({ ...prev, state: 'reconnecting' }));
        // Try reconnecting after 2 seconds
        reconnectTimeoutRef.current = setTimeout(connectWs, 2000);
      };

      ws.onerror = (err) => {
        console.warn('[CollabCanvas] WebSocket error, will reconnect...', err);
        ws.close();
      };
    } catch (e) {
      console.error('[CollabCanvas] WebSocket connection failed:', e);
      reconnectTimeoutRef.current = setTimeout(connectWs, 3000);
    }
  }, [currentUser, onCanvasClearedNotification, onRateLimitWarning]);

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
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWs]);

  // Optional Supabase Realtime Sync Integration
  useEffect(() => {
    const supabase = getSupabaseClient();
    const config = getStoredSupabaseConfig();
    if (!supabase || !config) return;

    let channel: any = null;
    try {
      channel = supabase
        .channel('collab-drawings')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'drawings' },
          (payload: any) => {
            const row = payload.new;
            if (row && !knownStrokeIds.current.has(row.id)) {
              const parsedStroke: Stroke = {
                id: row.id,
                userId: row.user_id,
                username: row.username,
                tool: row.tool,
                color: row.color,
                size: Number(row.size),
                opacity: Number(row.opacity),
                points: row.points || [],
                shapeData: row.shape_data,
                createdAt: new Date(row.created_at).getTime(),
                isUndone: Boolean(row.is_undone),
              };
              knownStrokeIds.current.add(parsedStroke.id);
              setStrokes(prev => [...prev, parsedStroke]);
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('[CollabCanvas] Supabase Realtime subscribe note:', err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []);

  // Broadcast cursor movements throttled (max 30 times/sec)
  const broadcastCursor = useCallback(
    (x: number, y: number, tool: ToolType, isDrawing: boolean) => {
      const now = Date.now();
      if (now - lastCursorEmitTime.current < 33) return;
      lastCursorEmitTime.current = now;

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'cursor:move',
          cursor: { x, y, tool, isDrawing },
        };
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    []
  );

  // Broadcast live in-progress stroke points
  const broadcastLiveStroke = useCallback((liveStroke: Partial<Stroke> & { id: string }) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:live',
        stroke: {
          ...liveStroke,
          userId: currentUser.userId,
          username: currentUser.username,
        },
      };
      wsRef.current.send(JSON.stringify(msg));
    }
  }, [currentUser]);

  // Commit a completed stroke
  const commitStroke = useCallback(
    (stroke: Stroke) => {
      knownStrokeIds.current.add(stroke.id);
      // Optimistic local update
      setStrokes(prev => [...prev, stroke]);
      setMyUndoStack(prev => [...prev, stroke.id]);
      setMyRedoStack([]); // Clear redo stack on new action

      // Send via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = { type: 'stroke:commit', stroke };
        wsRef.current.send(JSON.stringify(msg));
      } else {
        pendingBuffer.current.push(stroke);
      }

      // If Supabase is available, asynchronously save there as well
      const supabase = getSupabaseClient();
      if (supabase) {
        supabase
          .from('drawings')
          .insert({
            id: stroke.id,
            user_id: stroke.userId,
            username: stroke.username,
            tool: stroke.tool,
            color: stroke.color,
            size: stroke.size,
            opacity: stroke.opacity,
            points: stroke.points,
            shape_data: stroke.shapeData || null,
            is_undone: false,
          })
          .then(({ error }: any) => {
            if (error) console.warn('[CollabCanvas] Supabase stroke insert note:', error.message);
          });
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

    // Send to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:undo',
        strokeId: strokeIdToUndo,
        userId: currentUser.userId,
      };
      wsRef.current.send(JSON.stringify(msg));
    }

    // Supabase update if configured
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('drawings').update({ is_undone: true }).eq('id', strokeIdToUndo);
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

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:redo',
        strokeId: strokeIdToRedo,
        userId: currentUser.userId,
      };
      wsRef.current.send(JSON.stringify(msg));
    }

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase.from('drawings').update({ is_undone: false }).eq('id', strokeIdToRedo);
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

      // 2. Broadcast immediately over WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'canvas:clear',
          passcode: '',
          userId: currentUser.userId,
        };
        wsRef.current.send(JSON.stringify(msg));
      }

      // 3. Notify server endpoint
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
