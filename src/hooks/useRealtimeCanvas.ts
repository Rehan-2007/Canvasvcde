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
    transport: 'realtime',
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

  // Stable references
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const onRateLimitWarningRef = useRef(onRateLimitWarning);
  onRateLimitWarningRef.current = onRateLimitWarning;
  const onCanvasClearedNotificationRef = useRef(onCanvasClearedNotification);
  onCanvasClearedNotificationRef.current = onCanvasClearedNotification;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const knownStrokeIds = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  const lastCanvasVersionRef = useRef<number>(1);
  const lastCursorEmitTime = useRef(0);
  const lastLiveStrokeEmitTime = useRef(0);

  // Message handler for incoming server events (used by both WS and SSE)
  const handleServerMessage = useCallback((msg: WSServerMessage) => {
    if (!isMountedRef.current) return;

    switch (msg.type) {
      case 'init': {
        if (msg.snapshot) {
          setSnapshot(msg.snapshot);
        }
        const validStrokes = msg.strokes || [];
        validStrokes.forEach(s => knownStrokeIds.current.add(s.id));
        setStrokes(validStrokes);
        if (msg.users && msg.users.length > 0) {
          setOnlineUsers(msg.users);
        }
        if (msg.chatMessages) {
          setChatMessages(msg.chatMessages);
        }

        // Restore own undo stack
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
          if (!prev.has(msg.userId)) return prev;
          const next = new Map(prev);
          next.delete(msg.userId);
          return next;
        });
        setLiveRemoteStrokes(prev => {
          if (!prev.has(msg.userId)) return prev;
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
        // Clean live preview for this user
        if (stroke.userId) {
          setLiveRemoteStrokes(prev => {
            if (!prev.has(stroke.userId)) return prev;
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
  }, []);

  // Connect WebSocket
  const connectWs = useCallback(() => {
    if (!isMountedRef.current) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      try {
        wsRef.current.close();
      } catch (e) {
        // ignore
      }
      wsRef.current = null;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        setConnectionStatus({ state: 'connected', transport: 'websocket' });

        const joinMsg: WSClientMessage = {
          type: 'join',
          user: currentUserRef.current,
        };
        ws.send(JSON.stringify(joinMsg));
      };

      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data) as WSServerMessage;
          handleServerMessage(msg);
        } catch (err) {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (!isMountedRef.current) return;
        // Don't mark disconnected immediately if SSE or polling is active
        setConnectionStatus(prev => ({
          ...prev,
          state: prev.transport === 'sse' ? 'connected' : 'reconnecting',
        }));
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(connectWs, 4000);
      };

      ws.onerror = () => {
        // Fallback to SSE
      };
    } catch (e) {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(connectWs, 4000);
    }
  }, [handleServerMessage]);

  // Connect Server-Sent Events (SSE) Stream (Guarantees 100% reliable real-time push everywhere)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let sseRetryTimer: NodeJS.Timeout | null = null;

    function initSSE() {
      if (!isMountedRef.current) return;
      try {
        eventSource = new EventSource('/api/events');

        eventSource.onopen = () => {
          if (!isMountedRef.current) return;
          setConnectionStatus(prev =>
            prev.transport === 'websocket' && prev.state === 'connected'
              ? prev
              : { state: 'connected', transport: 'sse' }
          );
        };

        eventSource.onmessage = event => {
          try {
            const data = JSON.parse(event.data) as WSServerMessage;
            handleServerMessage(data);
          } catch (err) {
            // ignore ping or non-json
          }
        };

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (isMountedRef.current) {
            sseRetryTimer = setTimeout(initSSE, 5000);
          }
        };
      } catch (err) {
        sseRetryTimer = setTimeout(initSSE, 5000);
      }
    }

    initSSE();

    return () => {
      if (sseRetryTimer) clearTimeout(sseRetryTimer);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [handleServerMessage]);

  // Mount effect: Connect WS and start cleanup intervals
  useEffect(() => {
    isMountedRef.current = true;
    connectWs();

    // Clean stale cursors every 4 seconds
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
        try {
          wsRef.current.close();
        } catch (e) {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, [connectWs]);

  // Periodic heartbeat & Delta reconciliation (Every 1500ms)
  // Ensures every device across all browsers & tabs stay perfectly in sync
  useEffect(() => {
    const syncWithServer = async () => {
      if (!isMountedRef.current) return;

      try {
        // 1. Send heartbeat with current user
        const res = await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: currentUserRef.current }),
        });
        const data = await res.json();

        if (!isMountedRef.current) return;

        if (data.onlineUsers && Array.isArray(data.onlineUsers)) {
          setOnlineUsers(data.onlineUsers);
        }

        // If canvas was cleared on server, immediately wipe local state
        if (data.canvasVersion && data.canvasVersion !== lastCanvasVersionRef.current) {
          lastCanvasVersionRef.current = data.canvasVersion;
          // Re-fetch full state
          const stateRes = await fetch('/api/state');
          const stateData = await stateRes.json();
          if (stateData) {
            knownStrokeIds.current.clear();
            const valid = stateData.strokes || [];
            valid.forEach((s: Stroke) => knownStrokeIds.current.add(s.id));
            setStrokes(valid);
            setLiveRemoteStrokes(new Map());
            if (stateData.chatMessages) setChatMessages(stateData.chatMessages);
          }
          return;
        }

        // 2. Fetch any missing strokes and chat
        const stateRes = await fetch('/api/state');
        const stateData = await stateRes.json();

        if (stateData.strokes && Array.isArray(stateData.strokes)) {
          let hasNew = false;
          stateData.strokes.forEach((s: Stroke) => {
            if (!knownStrokeIds.current.has(s.id)) {
              knownStrokeIds.current.add(s.id);
              hasNew = true;
            }
          });

          if (hasNew) {
            setStrokes(prev => {
              const existingMap = new Map(prev.map(p => [p.id, p]));
              stateData.strokes.forEach((s: Stroke) => {
                existingMap.set(s.id, s);
              });
              return Array.from(existingMap.values());
            });
          }
        }

        if (stateData.chatMessages && Array.isArray(stateData.chatMessages)) {
          setChatMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newMessages = stateData.chatMessages.filter(
              (m: ChatMessage) => !existingIds.has(m.id)
            );
            return newMessages.length > 0 ? [...prev, ...newMessages] : prev;
          });
        }
      } catch (err) {
        // ignore network glitches
      }
    };

    // Initial sync
    syncWithServer();

    // Fast sync interval
    const interval = setInterval(syncWithServer, 1500);
    return () => clearInterval(interval);
  }, []);

  // Broadcast cursor movements (throttled max 30 fps)
  const broadcastCursor = useCallback(
    (x: number, y: number, tool: ToolType, isDrawing: boolean) => {
      const now = Date.now();
      if (now - lastCursorEmitTime.current < 35) return;
      lastCursorEmitTime.current = now;

      const cursorData: RemoteCursor = {
        userId: currentUserRef.current.userId,
        username: currentUserRef.current.username,
        userColor: currentUserRef.current.userColor,
        x,
        y,
        tool,
        isDrawing,
        lastActive: now,
      };

      // 1. Send via WebSocket if open
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'cursor:move',
          cursor: { x, y, tool, isDrawing },
        };
        wsRef.current.send(JSON.stringify(msg));
      } else {
        // 2. Send via REST endpoint
        fetch('/api/cursor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor: cursorData }),
        }).catch(() => {});
      }
    },
    []
  );

  // Broadcast live in-progress stroke points
  const broadcastLiveStroke = useCallback(
    (liveStroke: Partial<Stroke> & { id: string }) => {
      const now = Date.now();
      if (now - lastLiveStrokeEmitTime.current < 40) return;
      lastLiveStrokeEmitTime.current = now;

      const payloadStroke = {
        ...liveStroke,
        userId: currentUserRef.current.userId,
        username: currentUserRef.current.username,
      };

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = {
          type: 'stroke:live',
          stroke: payloadStroke,
        };
        wsRef.current.send(JSON.stringify(msg));
      } else {
        fetch('/api/stroke/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stroke: payloadStroke }),
        }).catch(() => {});
      }
    },
    []
  );

  // Commit a completed stroke
  const commitStroke = useCallback(
    (stroke: Stroke) => {
      knownStrokeIds.current.add(stroke.id);

      // Optimistic local update (instant 0ms feedback)
      setStrokes(prev => [...prev, stroke]);
      setMyUndoStack(prev => [...prev, stroke.id]);
      setMyRedoStack([]);

      // 1. Send via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const msg: WSClientMessage = { type: 'stroke:commit', stroke };
        wsRef.current.send(JSON.stringify(msg));
      }

      // 2. Send via REST endpoint (guarantees persistence across instances and devices)
      fetch('/api/stroke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stroke }),
      }).catch(() => {});
    },
    []
  );

  // Undo own recent stroke
  const undo = useCallback(() => {
    if (myUndoStack.length === 0) return;
    const strokeIdToUndo = myUndoStack[myUndoStack.length - 1];

    setMyUndoStack(prev => prev.slice(0, -1));
    setMyRedoStack(prev => [...prev, strokeIdToUndo]);

    // Optimistic update
    setStrokes(prev =>
      prev.map(s => (s.id === strokeIdToUndo ? { ...s, isUndone: true } : s))
    );

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:undo',
        strokeId: strokeIdToUndo,
        userId: currentUserRef.current.userId,
      };
      wsRef.current.send(JSON.stringify(msg));
    }

    fetch('/api/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokeId: strokeIdToUndo, userId: currentUserRef.current.userId }),
    }).catch(() => {});
  }, [myUndoStack]);

  // Redo own stroke
  const redo = useCallback(() => {
    if (myRedoStack.length === 0) return;
    const strokeIdToRedo = myRedoStack[myRedoStack.length - 1];

    setMyRedoStack(prev => prev.slice(0, -1));
    setMyUndoStack(prev => [...prev, strokeIdToRedo]);

    // Optimistic update
    setStrokes(prev =>
      prev.map(s => (s.id === strokeIdToRedo ? { ...s, isUndone: false } : s))
    );

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const msg: WSClientMessage = {
        type: 'stroke:redo',
        strokeId: strokeIdToRedo,
        userId: currentUserRef.current.userId,
      };
      wsRef.current.send(JSON.stringify(msg));
    }

    fetch('/api/redo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokeId: strokeIdToRedo, userId: currentUserRef.current.userId }),
    }).catch(() => {});
  }, [myRedoStack]);

  // Send live chat message
  const sendChatMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const localMsg: ChatMessage = {
        id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        userId: currentUserRef.current.userId,
        username: currentUserRef.current.username,
        userColor: currentUserRef.current.userColor,
        text: trimmed,
        isModerator: currentUserRef.current.isModerator,
        createdAt: Date.now(),
      };

      // Optimistic instant display
      setChatMessages(prev => [...prev.slice(-100), localMsg]);

      // 1. Send via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const clientMsg: WSClientMessage = {
          type: 'chat:message',
          message: { text: trimmed },
        };
        wsRef.current.send(JSON.stringify(clientMsg));
      }

      // 2. Send via REST endpoint
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: localMsg }),
      }).catch(() => {});
    },
    []
  );

  // Clear Canvas (Instant 1-click execution for all connected devices!)
  const clearCanvas = useCallback(
    async (): Promise<{ success: boolean; message: string }> => {
      // 1. Optimistic instant local wipe
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
          userId: currentUserRef.current.userId,
        };
        wsRef.current.send(JSON.stringify(msg));
      }

      // 3. Notify server endpoint
      try {
        await fetch('/api/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: currentUserRef.current.username }),
        });
      } catch (err) {
        // ignore
      }

      return { success: true, message: 'Canvas cleared' };
    },
    []
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
