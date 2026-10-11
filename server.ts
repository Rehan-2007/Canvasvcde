import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import type { Stroke, ChatMessage, CanvasSnapshot, OnlineUser, RemoteCursor, WSClientMessage, WSServerMessage, UserReport } from './src/types.js';

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
}

let state: ServerState = {
  strokes: [],
  snapshots: [],
  chatMessages: [],
  reports: [],
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
    console.log(`[CollabCanvas] Loaded ${state.strokes.length} strokes, ${state.chatMessages.length} messages, ${state.snapshots.length} snapshots from disk.`);
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
      // Keep only up to 2000 recent strokes and 100 chat messages to avoid unbounded file growth
      const dataToSave = {
        strokes: state.strokes.slice(-2000),
        snapshots: state.snapshots.slice(-5),
        chatMessages: state.chatMessages.slice(-100),
        reports: state.reports.slice(-50),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
    } catch (err) {
      console.error('[CollabCanvas] Error saving state to disk:', err);
    }
  }, 3000);
}

// Rate limiting trackers
interface ClientRateLimit {
  strokeCount: number;
  strokeWindowStart: number;
  chatCount: number;
  chatWindowStart: number;
}
const rateLimits = new Map<string, ClientRateLimit>();

function checkRateLimit(clientId: string, type: 'stroke' | 'chat'): boolean {
  const now = Date.now();
  let limit = rateLimits.get(clientId);
  if (!limit) {
    limit = { strokeCount: 0, strokeWindowStart: now, chatCount: 0, chatWindowStart: now };
    rateLimits.set(clientId, limit);
  }

  if (type === 'stroke') {
    if (now - limit.strokeWindowStart > 1000) {
      limit.strokeCount = 0;
      limit.strokeWindowStart = now;
    }
    limit.strokeCount++;
    return limit.strokeCount <= 60; // Max 60 stroke events per second
  } else {
    if (now - limit.chatWindowStart > 5000) {
      limit.chatCount = 0;
      limit.chatWindowStart = now;
    }
    limit.chatCount++;
    return limit.chatCount <= 6; // Max 6 messages per 5 seconds
  }
}

// Connected clients tracking
interface ConnectedClient {
  ws: WebSocket;
  user: OnlineUser;
  ip: string;
}
const clients = new Map<string, ConnectedClient>();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.json({ limit: '10mb' }));

  // REST API Endpoints
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      onlineUsers: clients.size,
      strokeCount: state.strokes.length,
      snapshotCount: state.snapshots.length,
      chatCount: state.chatMessages.length,
      supabaseConfigured: Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY),
    });
  });

  app.get('/api/state', (req, res) => {
    const latestSnapshot = state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
    res.json({
      snapshot: latestSnapshot,
      strokes: state.strokes.filter(s => !s.isUndone).slice(-500),
      chatMessages: state.chatMessages.slice(-50),
    });
  });

  app.post('/api/moderator/verify', (req, res) => {
    const { passcode } = req.body;
    if (passcode === MODERATOR_PASSCODE) {
      res.json({ success: true, message: 'Moderator authorized' });
    } else {
      res.status(401).json({ success: false, message: 'Invalid moderator passcode' });
    }
  });

  app.post('/api/moderator/clear', (req, res) => {
    const { username } = req.body;

    state.strokes = [];
    state.snapshots = [];
    scheduleSave();

    const broadcastMsg: WSServerMessage = {
      type: 'canvas:cleared',
      moderatorUsername: username || 'Artist',
      timestamp: Date.now(),
    };
    broadcast(JSON.stringify(broadcastMsg));

    res.json({ success: true, message: 'Canvas cleared' });
  });

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

  app.get('/api/supabase/schema', (req, res) => {
    try {
      const schemaPath = path.resolve('./schema.sql');
      if (fs.existsSync(schemaPath)) {
        res.type('text/plain').send(fs.readFileSync(schemaPath, 'utf-8'));
      } else {
        res.status(404).send('schema.sql not found');
      }
    } catch (err) {
      res.status(500).send('Error reading schema');
    }
  });

  // WebSocket Server Setup
  function broadcast(data: string, excludeWs?: WebSocket) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
        client.send(data);
      }
    });
  }

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
          clients.set(currentUserId, { ws, user, ip });

          // Send initial state to the newly connected user
          const latestSnapshot = state.snapshots.length > 0 ? state.snapshots[state.snapshots.length - 1] : null;
          const activeStrokes = state.strokes.filter(s => !s.isUndone).slice(-800);
          const onlineList = Array.from(clients.values()).map(c => c.user);

          const initMsg: WSServerMessage = {
            type: 'init',
            userId: currentUserId,
            users: onlineList,
            snapshot: latestSnapshot,
            strokes: activeStrokes,
            chatMessages: state.chatMessages.slice(-50),
          };
          ws.send(JSON.stringify(initMsg));

          // Broadcast user joined to other clients
          const joinMsg: WSServerMessage = { type: 'user:joined', user };
          broadcast(JSON.stringify(joinMsg), ws);
        } else if (msg.type === 'cursor:move') {
          if (!currentUserId) return;
          const clientData = clients.get(currentUserId);
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
          broadcast(JSON.stringify(cursorMsg), ws);
        } else if (msg.type === 'stroke:live') {
          if (!currentUserId) return;
          if (!checkRateLimit(currentUserId, 'stroke')) return;

          // Broadcast live drawing coordinates for ultra-low latency real-time drawing
          const liveMsg: WSServerMessage = { type: 'stroke:live', stroke: msg.stroke };
          broadcast(JSON.stringify(liveMsg), ws);
        } else if (msg.type === 'stroke:commit') {
          if (!currentUserId) return;
          if (!checkRateLimit(currentUserId, 'stroke')) {
            ws.send(JSON.stringify({ type: 'rate_limit', message: 'Drawing too fast! Please slow down.' }));
            return;
          }

          const stroke = msg.stroke;
          // Guard against duplicate strokes
          const exists = state.strokes.some(s => s.id === stroke.id);
          if (!exists) {
            state.strokes.push(stroke);
            scheduleSave();

            const commitMsg: WSServerMessage = { type: 'stroke:commit', stroke };
            broadcast(JSON.stringify(commitMsg), ws);
          }
        } else if (msg.type === 'stroke:undo') {
          if (!currentUserId) return;
          const { strokeId, userId } = msg;
          // Mark stroke as undone
          const stroke = state.strokes.find(s => s.id === strokeId && s.userId === userId);
          if (stroke) {
            stroke.isUndone = true;
            scheduleSave();
            const undoMsg: WSServerMessage = { type: 'stroke:undo', strokeId, userId };
            broadcast(JSON.stringify(undoMsg));
          }
        } else if (msg.type === 'stroke:redo') {
          if (!currentUserId) return;
          const { strokeId, userId } = msg;
          const stroke = state.strokes.find(s => s.id === strokeId && s.userId === userId);
          if (stroke) {
            stroke.isUndone = false;
            scheduleSave();
            const redoMsg: WSServerMessage = { type: 'stroke:redo', stroke };
            broadcast(JSON.stringify(redoMsg));
          }
        } else if (msg.type === 'canvas:clear') {
          const clientData = currentUserId ? clients.get(currentUserId) : null;
          state.strokes = [];
          state.snapshots = [];
          scheduleSave();

          const clearMsg: WSServerMessage = {
            type: 'canvas:cleared',
            moderatorUsername: clientData?.user.username || 'Artist',
            timestamp: Date.now(),
          };
          broadcast(JSON.stringify(clearMsg));
        } else if (msg.type === 'chat:message') {
          const clientData = currentUserId ? clients.get(currentUserId) : null;
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
          broadcast(JSON.stringify(broadcastChat));
        } else if (msg.type === 'snapshot:create') {
          // Store canvas snapshot
          const snapshot: CanvasSnapshot = {
            id: 'snap_' + Date.now(),
            dataUrl: msg.dataUrl,
            strokeCount: msg.strokeCount,
            createdAt: Date.now(),
          };
          state.snapshots.push(snapshot);
          scheduleSave();

          const snapMsg: WSServerMessage = { type: 'snapshot:saved', snapshot };
          broadcast(JSON.stringify(snapMsg));
        } else if (msg.type === 'report:submit') {
          const newReport: UserReport = {
            id: 'rep_' + Date.now(),
            reporterId: currentUserId || 'unknown',
            reportedUserId: msg.report.reportedUserId,
            reportedUsername: msg.report.reportedUsername,
            reason: msg.report.reason,
            contextType: msg.report.contextType,
            contextId: msg.report.contextId,
            createdAt: Date.now(),
          };
          state.reports.push(newReport);
          scheduleSave();
        }
      } catch (err) {
        console.error('[CollabCanvas] WS parse error:', err);
      }
    });

    ws.on('close', () => {
      if (currentUserId) {
        clients.delete(currentUserId);
        rateLimits.delete(currentUserId);
        const leaveMsg: WSServerMessage = { type: 'user:left', userId: currentUserId };
        broadcast(JSON.stringify(leaveMsg));
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
