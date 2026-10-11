import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import type {
  Stroke,
  ChatMessage,
  CanvasSnapshot,
  OnlineUser,
  RemoteCursor,
  WSClientMessage,
  WSServerMessage,
  UserReport,
} from './src/types.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const MODERATOR_PASSCODE = process.env.MODERATOR_PASSCODE || 'collab-mod-2026';
const DATA_DIR = path.resolve('./data');
const STATE_FILE = path.join(DATA_DIR, 'collab-state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory persistent state
interface ServerState {
  strokes: Stroke[];
  snapshots: CanvasSnapshot[];
  chatMessages: ChatMessage[];
  reports: UserReport[];
  canvasVersion: number;
  clearedAt: number;
}

let state: ServerState = {
  strokes: [],
  snapshots: [],
  chatMessages: [],
  reports: [],
  canvasVersion: 1,
  clearedAt: 0,
};

// Load initial state from disk if available
try {
  if (fs.existsSync(STATE_FILE)) {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    state.strokes = Array.isArray(parsed.strokes) ? parsed.strokes : [];
    state.snapshots = Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
    state.chatMessages = Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [];
    state.reports = Array.isArray(parsed.reports) ? parsed.reports : [];
    state.canvasVersion = typeof parsed.canvasVersion === 'number' ? parsed.canvasVersion : 1;
    state.clearedAt = typeof parsed.clearedAt === 'number' ? parsed.clearedAt : 0;
    console.log(
      `[CollabCanvas] Loaded ${state.strokes.length} strokes, ${state.chatMessages.length} messages, ${state.snapshots.length} snapshots from disk.`
    );
  }
} catch (err) {
  console.error('[CollabCanvas] Error loading state from disk:', err);
}

// Throttled persistence helper
let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      const dataToSave = {
        strokes: state.strokes.slice(-2500),
        snapshots: state.snapshots.slice(-5),
        chatMessages: state.chatMessages.slice(-150),
        reports: state.reports.slice(-50),
        canvasVersion: state.canvasVersion,
        clearedAt: state.clearedAt,
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
    } catch (err) {
      console.error('[CollabCanvas] Error saving state to disk:', err);
    }
  }, 2000);
}

// Track active online users across all connection types (WebSocket, SSE, Polling)
const activeUsers = new Map<string, { user: OnlineUser; lastSeen: number }>();

function touchUser(user: OnlineUser) {
  if (!user || !user.userId) return;
  activeUsers.set(user.userId, {
    user: {
      userId: user.userId,
      username: user.username || 'Artist',
      userColor: user.userColor || '#38bdf8',
      isModerator: Boolean(user.isModerator),
      joinedAt: user.joinedAt || Date.now(),
    },
    lastSeen: Date.now(),
  });
}

function getOnlineUsersList(): OnlineUser[] {
  const now = Date.now();
  const list: OnlineUser[] = [];
  for (const [uid, item] of activeUsers.entries()) {
    if (now - item.lastSeen > 15000) {
      activeUsers.delete(uid);
    } else {
      list.push(item.user);
    }
  }
  return list;
}

// Clean stale users every 5 seconds
setInterval(() => {
  const now = Date.now();
  for (const [uid, item] of activeUsers.entries()) {
    if (now - item.lastSeen > 15000) {
      activeUsers.delete(uid);
    }
  }
}, 5000);

// SSE connection pool
const sseClients = new Set<express.Response>();

// Connected WebSocket clients
interface ConnectedClient {
  ws: WebSocket;
  user: OnlineUser;
  ip: string;
}
const wsClients = new Map<string, ConnectedClient>();

// Unified Broadcast: pushes to all open WebSocket connections AND all active SSE streams
function broadcastAll(messageObj: WSServerMessage, excludeWs?: WebSocket) {
  const payloadStr = JSON.stringify(messageObj);

  // 1. WebSocket Broadcast
  wsClients.forEach(({ ws }) => {
    if (ws.readyState === WebSocket.OPEN && ws !== excludeWs) {
      try {
        ws.send(payloadStr);
      } catch (e) {
        // ignore send error
      }
    }
  });

  // 2. SSE Broadcast
  const sseData = `data: ${payloadStr}\n\n`;
  sseClients.forEach(res => {
    try {
      res.write(sseData);
    } catch (e) {
      sseClients.delete(res);
    }
  });
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // Configure WebSocket server specifically on path '/ws' to avoid conflicting with Vite
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    // Handle WebSocket on /ws or root without vite query
    if (url.pathname === '/ws' || url.pathname === '/') {
      // Don't intercept Vite HMR requests
      const secProtocol = request.headers['sec-websocket-protocol'] || '';
      if (secProtocol.includes('vite-hmr')) {
        return;
      }
      wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request);
      });
    }
  });

  app.use(express.json({ limit: '15mb' }));

  // CORS for preview environments
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // --- REST & SSE Endpoints ---

  // Health check
  app.get('/api/health', (req, res) => {
    const online = getOnlineUsersList();
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      onlineCount: online.length,
      strokeCount: state.strokes.filter(s => !s.isUndone).length,
      chatCount: state.chatMessages.length,
      canvasVersion: state.canvasVersion,
    });
  });

  // Full & Delta State Endpoint
  app.get('/api/state', (req, res) => {
    const sinceTime = parseInt(req.query.since as string, 10) || 0;
    const latestSnapshot =
      state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;

    const activeStrokes = state.strokes.filter(s => !s.isUndone && (sinceTime === 0 || s.createdAt > sinceTime));
    const online = getOnlineUsersList();

    res.json({
      canvasVersion: state.canvasVersion,
      clearedAt: state.clearedAt,
      snapshot: latestSnapshot,
      strokes: activeStrokes.slice(-1000),
      chatMessages: state.chatMessages.slice(-60),
      onlineUsers: online,
    });
  });

  // Server-Sent Events (SSE) stream for 100% reliable real-time push to all devices
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': ping\n\n');

    // Register SSE client
    sseClients.add(res);

    // Initial state sent down the stream
    const online = getOnlineUsersList();
    const initMsg: WSServerMessage = {
      type: 'init',
      userId: 'sse_' + Date.now(),
      users: online,
      snapshot: state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null,
      strokes: state.strokes.filter(s => !s.isUndone).slice(-800),
      chatMessages: state.chatMessages.slice(-60),
    };
    res.write(`data: ${JSON.stringify(initMsg)}\n\n`);

    // Keepalive ping every 15s to keep connection open through Cloud Run proxies
    const keepalive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (err) {
        clearInterval(keepalive);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepalive);
      sseClients.delete(res);
    });
  });

  // Heartbeat endpoint
  app.post('/api/heartbeat', (req, res) => {
    const { user } = req.body;
    if (user && user.userId) {
      touchUser(user);
    }
    const online = getOnlineUsersList();
    res.json({
      success: true,
      onlineUsers: online,
      canvasVersion: state.canvasVersion,
      clearedAt: state.clearedAt,
    });
  });

  // Commit stroke via REST
  app.post('/api/stroke', (req, res) => {
    const { stroke } = req.body;
    if (stroke && stroke.id) {
      const exists = state.strokes.some(s => s.id === stroke.id);
      if (!exists) {
        state.strokes.push(stroke);
        scheduleSave();

        // Broadcast to all connected devices immediately!
        const commitMsg: WSServerMessage = { type: 'stroke:commit', stroke };
        broadcastAll(commitMsg);
      }
    }
    res.json({ success: true, count: state.strokes.length });
  });

  // Broadcast live in-progress stroke via REST
  app.post('/api/stroke/live', (req, res) => {
    const { stroke } = req.body;
    if (stroke && stroke.id) {
      const liveMsg: WSServerMessage = { type: 'stroke:live', stroke };
      broadcastAll(liveMsg);
    }
    res.json({ success: true });
  });

  // Broadcast cursor position via REST
  app.post('/api/cursor', (req, res) => {
    const { cursor } = req.body;
    if (cursor && cursor.userId) {
      const cursorMsg: WSServerMessage = { type: 'cursor:update', cursor };
      broadcastAll(cursorMsg);
    }
    res.json({ success: true });
  });

  // Undo stroke via REST
  app.post('/api/undo', (req, res) => {
    const { strokeId, userId } = req.body;
    if (strokeId) {
      const stroke = state.strokes.find(s => s.id === strokeId);
      if (stroke) {
        stroke.isUndone = true;
        scheduleSave();
        const undoMsg: WSServerMessage = { type: 'stroke:undo', strokeId, userId };
        broadcastAll(undoMsg);
      }
    }
    res.json({ success: true });
  });

  // Redo stroke via REST
  app.post('/api/redo', (req, res) => {
    const { strokeId, userId } = req.body;
    if (strokeId) {
      const stroke = state.strokes.find(s => s.id === strokeId);
      if (stroke) {
        stroke.isUndone = false;
        scheduleSave();
        const redoMsg: WSServerMessage = { type: 'stroke:redo', stroke };
        broadcastAll(redoMsg);
      }
    }
    res.json({ success: true });
  });

  // Send Chat message via REST
  app.post('/api/chat', (req, res) => {
    const { message } = req.body;
    if (message && message.text) {
      const chatMsg: ChatMessage = {
        id: message.id || 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        userId: message.userId || 'usr_anon',
        username: message.username || 'Artist',
        userColor: message.userColor || '#38bdf8',
        text: String(message.text).trim().slice(0, 400),
        isModerator: Boolean(message.isModerator),
        createdAt: message.createdAt || Date.now(),
      };

      const exists = state.chatMessages.some(m => m.id === chatMsg.id);
      if (!exists) {
        state.chatMessages.push(chatMsg);
        scheduleSave();

        const broadcastChat: WSServerMessage = { type: 'chat:message', message: chatMsg };
        broadcastAll(broadcastChat);
      }
    }
    res.json({ success: true });
  });

  // Clear Canvas (Instantly wipes for everyone across all devices!)
  app.post('/api/clear', (req, res) => {
    const { username } = req.body;

    state.strokes = [];
    state.snapshots = [];
    state.canvasVersion += 1;
    state.clearedAt = Date.now();
    scheduleSave();

    const clearMsg: WSServerMessage = {
      type: 'canvas:cleared',
      moderatorUsername: username || 'Artist',
      timestamp: Date.now(),
    };
    broadcastAll(clearMsg);

    res.json({ success: true, message: 'Canvas cleared successfully', canvasVersion: state.canvasVersion });
  });

  // Moderator alias for backward compatibility
  app.post('/api/moderator/clear', (req, res) => {
    const { username } = req.body;
    state.strokes = [];
    state.snapshots = [];
    state.canvasVersion += 1;
    state.clearedAt = Date.now();
    scheduleSave();

    const clearMsg: WSServerMessage = {
      type: 'canvas:cleared',
      moderatorUsername: username || 'Artist',
      timestamp: Date.now(),
    };
    broadcastAll(clearMsg);
    res.json({ success: true, message: 'Canvas cleared' });
  });

  // Report user
  app.post('/api/report', (req, res) => {
    const { report } = req.body;
    if (report && report.reportedUserId && report.reason) {
      const newReport: UserReport = {
        id: 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        reporterId: report.reporterId || 'anonymous',
        reportedUserId: report.reportedUserId,
        reportedUsername: report.reportedUsername || 'Unknown',
        reason: String(report.reason).slice(0, 300),
        contextType: report.contextType || 'chat',
        contextId: report.contextId,
        createdAt: Date.now(),
      };
      state.reports.push(newReport);
      scheduleSave();
      res.json({ success: true, reportId: newReport.id });
    } else {
      res.status(400).json({ success: false, message: 'Invalid report data' });
    }
  });

  // WebSocket Connection Handler
  wss.on('connection', (ws: WebSocket, req) => {
    const ip = req.socket.remoteAddress || '127.0.0.1';
    let currentUserId: string | null = null;

    ws.on('message', (messageData: string) => {
      try {
        const msg = JSON.parse(messageData.toString()) as WSClientMessage;

        if (msg.type === 'join') {
          currentUserId = msg.user.userId;
          const user: OnlineUser = {
            userId: msg.user.userId,
            username: msg.user.username,
            userColor: msg.user.userColor,
            isModerator: msg.user.isModerator,
            joinedAt: Date.now(),
          };
          wsClients.set(currentUserId, { ws, user, ip });
          touchUser(user);

          // Send current state
          const latestSnapshot =
            state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
          const activeStrokes = state.strokes.filter(s => !s.isUndone).slice(-800);
          const onlineList = getOnlineUsersList();

          const initMsg: WSServerMessage = {
            type: 'init',
            userId: currentUserId,
            users: onlineList,
            snapshot: latestSnapshot,
            strokes: activeStrokes,
            chatMessages: state.chatMessages.slice(-60),
          };
          ws.send(JSON.stringify(initMsg));

          // Broadcast user joined
          const joinMsg: WSServerMessage = { type: 'user:joined', user };
          broadcastAll(joinMsg, ws);
        } else if (msg.type === 'cursor:move') {
          if (!currentUserId) return;
          const clientData = wsClients.get(currentUserId);
          if (!clientData) return;

          const remoteCursor: RemoteCursor = {
            userId: currentUserId,
            username: clientData.user.username,
            userColor: clientData.user.userColor,
            x: msg.cursor.x,
            y: msg.cursor.y,
            tool: msg.cursor.tool,
            isDrawing: msg.cursor.isDrawing,
            lastActive: Date.now(),
          };
          const cursorMsg: WSServerMessage = { type: 'cursor:update', cursor: remoteCursor };
          broadcastAll(cursorMsg, ws);
        } else if (msg.type === 'stroke:live') {
          const liveMsg: WSServerMessage = { type: 'stroke:live', stroke: msg.stroke };
          broadcastAll(liveMsg, ws);
        } else if (msg.type === 'stroke:commit') {
          const stroke = msg.stroke;
          const exists = state.strokes.some(s => s.id === stroke.id);
          if (!exists) {
            state.strokes.push(stroke);
            scheduleSave();

            const commitMsg: WSServerMessage = { type: 'stroke:commit', stroke };
            broadcastAll(commitMsg, ws);
          }
        } else if (msg.type === 'stroke:undo') {
          const { strokeId, userId } = msg;
          const stroke = state.strokes.find(s => s.id === strokeId);
          if (stroke) {
            stroke.isUndone = true;
            scheduleSave();
            const undoMsg: WSServerMessage = { type: 'stroke:undo', strokeId, userId };
            broadcastAll(undoMsg);
          }
        } else if (msg.type === 'stroke:redo') {
          const { strokeId } = msg;
          const stroke = state.strokes.find(s => s.id === strokeId);
          if (stroke) {
            stroke.isUndone = false;
            scheduleSave();
            const redoMsg: WSServerMessage = { type: 'stroke:redo', stroke };
            broadcastAll(redoMsg);
          }
        } else if (msg.type === 'canvas:clear') {
          const clientData = currentUserId ? wsClients.get(currentUserId) : null;
          state.strokes = [];
          state.snapshots = [];
          state.canvasVersion += 1;
          state.clearedAt = Date.now();
          scheduleSave();

          const clearMsg: WSServerMessage = {
            type: 'canvas:cleared',
            moderatorUsername: clientData?.user.username || 'Artist',
            timestamp: Date.now(),
          };
          broadcastAll(clearMsg);
        } else if (msg.type === 'chat:message') {
          const clientData = currentUserId ? wsClients.get(currentUserId) : null;
          const senderUserId = currentUserId || 'usr_' + Date.now().toString(36);
          const senderUsername = clientData?.user.username || 'Artist';
          const senderColor = clientData?.user.userColor || '#38bdf8';

          const rawText = (msg.message?.text || '').trim();
          if (!rawText) return;
          const sanitizedText = rawText.slice(0, 400);

          const chatMsg: ChatMessage = {
            id: 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            userId: senderUserId,
            username: senderUsername,
            userColor: senderColor,
            text: sanitizedText,
            isModerator: clientData?.user.isModerator || false,
            createdAt: Date.now(),
          };

          state.chatMessages.push(chatMsg);
          scheduleSave();

          const broadcastChat: WSServerMessage = { type: 'chat:message', message: chatMsg };
          broadcastAll(broadcastChat);
        } else if (msg.type === 'snapshot:create') {
          const snapshot: CanvasSnapshot = {
            id: 'snap_' + Date.now(),
            dataUrl: msg.dataUrl,
            strokeCount: msg.strokeCount,
            createdAt: Date.now(),
          };
          state.snapshots.push(snapshot);
          scheduleSave();

          const snapMsg: WSServerMessage = { type: 'snapshot:saved', snapshot };
          broadcastAll(snapMsg);
        }
      } catch (err) {
        console.error('[CollabCanvas] WS parse error:', err);
      }
    });

    ws.on('close', () => {
      if (currentUserId) {
        wsClients.delete(currentUserId);
        const leaveMsg: WSServerMessage = { type: 'user:left', userId: currentUserId };
        broadcastAll(leaveMsg);
      }
    });
  });

  // Serve Vite in development or static in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve('./dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[CollabCanvas] Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[CollabCanvas] Fatal server start error:', err);
  process.exit(1);
});
