export type ToolType =
  | 'pen'
  | 'brush'
  | 'eraser'
  | 'rectangle'
  | 'circle'
  | 'triangle'
  | 'line'
  | 'arrow'
  | 'text'
  | 'fill'
  | 'pan';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface ShapeData {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  text?: string;
  filled?: boolean;
}

export interface Stroke {
  id: string;
  userId: string;
  username: string;
  tool: ToolType;
  color: string;
  size: number;
  opacity: number;
  points: Point[];
  shapeData?: ShapeData;
  createdAt: number;
  isUndone?: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  userColor: string;
  text: string;
  isModerator?: boolean;
  createdAt: number;
}

export interface RemoteCursor {
  userId: string;
  username: string;
  userColor: string;
  x: number;
  y: number;
  tool: ToolType;
  isDrawing: boolean;
  lastActive: number;
}

export interface CanvasSnapshot {
  id: string;
  dataUrl: string;
  strokeCount: number;
  createdAt: number;
}

export interface OnlineUser {
  userId: string;
  username: string;
  userColor: string;
  isModerator?: boolean;
  joinedAt: number;
}

export interface UserReport {
  id: string;
  reporterId: string;
  reportedUserId: string;
  reportedUsername: string;
  reason: string;
  contextType: 'chat' | 'drawing';
  contextId?: string;
  createdAt: number;
}

export interface ConnectionStatus {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  transport: 'websocket' | 'sse' | 'realtime' | 'syncing';
  latencyMs?: number;
}

export type WSClientMessage =
  | { type: 'join'; user: { userId: string; username: string; userColor: string; isModerator?: boolean } }
  | { type: 'user:update'; user: { userId: string; username: string; userColor: string } }
  | { type: 'cursor:move'; cursor: { x: number; y: number; tool: ToolType; isDrawing: boolean } }
  | { type: 'stroke:live'; stroke: Partial<Stroke> & { id: string } }
  | { type: 'stroke:commit'; stroke: Stroke }
  | { type: 'stroke:undo'; strokeId: string; userId: string }
  | { type: 'stroke:redo'; strokeId: string; userId: string }
  | { type: 'canvas:clear'; passcode: string; userId: string }
  | { type: 'chat:message'; message: { id?: string; text: string; userId?: string; username?: string; userColor?: string } }
  | { type: 'snapshot:create'; dataUrl: string; strokeCount: number }
  | { type: 'report:submit'; report: Omit<UserReport, 'id' | 'createdAt'> };

export type WSServerMessage =
  | {
      type: 'init';
      userId: string;
      users: OnlineUser[];
      snapshot: CanvasSnapshot | null;
      strokes: Stroke[];
      chatMessages: ChatMessage[];
      moderatorTokenValid?: boolean;
    }
  | { type: 'user:joined'; user: OnlineUser }
  | { type: 'user:left'; userId: string }
  | { type: 'user:updated'; user: OnlineUser }
  | { type: 'users:list'; users: OnlineUser[] }
  | { type: 'cursor:update'; cursor: RemoteCursor }
  | { type: 'stroke:live'; stroke: Partial<Stroke> & { id: string } }
  | { type: 'stroke:commit'; stroke: Stroke }
  | { type: 'stroke:undo'; strokeId: string; userId: string }
  | { type: 'stroke:redo'; stroke: Stroke }
  | { type: 'canvas:cleared'; moderatorUsername: string; timestamp: number }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'snapshot:saved'; snapshot: CanvasSnapshot }
  | { type: 'error'; message: string; code?: string }
  | { type: 'rate_limit'; message: string };
