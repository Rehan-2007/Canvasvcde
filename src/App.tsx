/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header.js';
import { Toolbar } from './components/Toolbar.js';
import { Canvas } from './components/Canvas.js';
import { ChatPanel } from './components/ChatPanel.js';
import { ClearModal } from './components/ClearModal.js';
import { ReportModal } from './components/ReportModal.js';
import { useRealtimeCanvas } from './hooks/useRealtimeCanvas.js';
import { useChat } from './hooks/useChat.js';
import { generateAnonymousUser, saveUsername } from './lib/colors.js';
import { ToolType } from './types.js';
import { exportStrokesToSVG, CANVAS_WIDTH, CANVAS_HEIGHT } from './lib/canvas-utils.js';
import { AlertCircle } from 'lucide-react';

export default function App() {
  // Current user state
  const [currentUser, setCurrentUser] = useState(() => generateAnonymousUser());

  // Tool & styling state
  const [currentTool, setCurrentTool] = useState<ToolType>('pen');
  const [currentColor, setCurrentColor] = useState<string>('#ffffff');
  const [brushSize, setBrushSize] = useState<number>(4);
  const [opacity, setOpacity] = useState<number>(1.0);
  const [isFilledShape, setIsFilledShape] = useState<boolean>(false);

  // Viewport navigation state (Zoom & Pan)
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // UI Panels and Modals
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [reportModalData, setReportModalData] = useState<{
    isOpen: boolean;
    targetUser: { userId: string; username: string } | null;
    contextId?: string;
  }>({
    isOpen: false,
    targetUser: null,
  });

  // Notification banners (Rate limits, Cleared notifications)
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const showBanner = useCallback((msg: string) => {
    setBannerMessage(msg);
    setTimeout(() => {
      setBannerMessage(prev => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  // Center initial canvas on mount
  useEffect(() => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const initialZoom = Math.min(Math.max(screenW / CANVAS_WIDTH, 0.4), 1.0);
    setZoom(initialZoom);
    setPan({
      x: (screenW - CANVAS_WIDTH * initialZoom) / 2,
      y: (screenH - CANVAS_HEIGHT * initialZoom) / 2,
    });
  }, []);

  // Update username handler
  const handleUpdateUsername = (newName: string) => {
    saveUsername(newName);
    setCurrentUser(prev => ({ ...prev, username: newName }));
  };

  const handleRateLimitWarning = useCallback((msg: string) => {
    showBanner(msg);
  }, [showBanner]);

  const handleCanvasCleared = useCallback((modName: string) => {
    showBanner(`Shared canvas cleared by ${modName}`);
  }, [showBanner]);

  // Real-time canvas engine & live communication hook (Single authoritative WebSocket)
  const {
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
  } = useRealtimeCanvas({
    currentUser,
    onRateLimitWarning: handleRateLimitWarning,
    onCanvasClearedNotification: handleCanvasCleared,
  });

  // Live chat moderation & filtering
  const {
    messages,
    sendMessage,
    mutedUsers,
    blockedUsers,
    toggleMuteUser,
    toggleBlockUser,
    submitReport,
  } = useChat({
    currentUser,
    rawMessages: chatMessages,
    onSendMessage: sendChatMessage,
  });

  // Keyboard Shortcuts (Undo, Redo, Tool switching, Pan)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === 'p' || e.key === 'P') {
        setCurrentTool('pen');
      } else if (e.key === 'b' || e.key === 'B') {
        setCurrentTool('brush');
      } else if (e.key === 'e' || e.key === 'E') {
        setCurrentTool('eraser');
      } else if (e.key === 't' || e.key === 'T') {
        setCurrentTool('text');
      } else if (e.key === 'f' || e.key === 'F') {
        setCurrentTool('fill');
      } else if (e.key === 'h' || e.key === 'H') {
        setCurrentTool('pan');
      } else if (e.key === '+' || e.key === '=') {
        setZoom(z => Math.min(3.5, z * 1.15));
      } else if (e.key === '-') {
        setZoom(z => Math.max(0.25, z * 0.85));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // Export to PNG Image
  const handleExportPNG = () => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_WIDTH;
    offscreen.height = CANVAS_HEIGHT;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;

    // Fill canvas background
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw ink canvas
    const baseCanvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (baseCanvas) {
      ctx.drawImage(baseCanvas, 0, 0);
    }

    const a = document.createElement('a');
    a.href = offscreen.toDataURL('image/png');
    a.download = `collabcanvas-${Date.now()}.png`;
    a.click();
  };

  // Export to SVG
  const handleExportSVG = () => {
    const svgString = exportStrokesToSVG(strokes);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `collabcanvas-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Zoom helpers
  const handleZoomIn = () => setZoom(z => Math.min(3.5, z * 1.2));
  const handleZoomOut = () => setZoom(z => Math.max(0.25, z * 0.8));
  const handleResetZoom = () => {
    setZoom(1.0);
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    setPan({
      x: (screenW - CANVAS_WIDTH) / 2,
      y: (screenH - CANVAS_HEIGHT) / 2,
    });
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-zinc-950 text-zinc-100 flex flex-col font-sans select-none antialiased">
      {/* Top Header */}
      <Header
        currentUser={currentUser}
        onUpdateUsername={handleUpdateUsername}
        connectionStatus={connectionStatus}
        onlineCount={onlineUsers.length}
        onOpenClearModal={() => setIsClearModalOpen(true)}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
      />

      {/* Main Workspace (Canvas + Floating Left Toolbar + Floating Right Chat) */}
      <div className="relative flex-1 w-full h-[calc(100vh-48px)] overflow-hidden">
        {/* Notification Banner */}
        {bannerMessage && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl text-xs text-zinc-200 animate-in fade-in slide-in-from-top-2 duration-150">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>{bannerMessage}</span>
          </div>
        )}

        {/* Central Collaborative Canvas */}
        <Canvas
          currentTool={currentTool}
          currentColor={currentColor}
          brushSize={brushSize}
          opacity={opacity}
          isFilledShape={isFilledShape}
          currentUser={currentUser}
          strokes={strokes}
          snapshot={snapshot}
          remoteCursors={remoteCursors}
          liveRemoteStrokes={liveRemoteStrokes}
          blockedUsers={blockedUsers}
          zoom={zoom}
          pan={pan}
          onZoomChange={setZoom}
          onPanChange={setPan}
          onCommitStroke={commitStroke}
          onBroadcastCursor={broadcastCursor}
          onBroadcastLiveStroke={broadcastLiveStroke}
          onSaveSnapshot={saveSnapshot}
        />

        {/* Left Toolbar */}
        <Toolbar
          currentTool={currentTool}
          onToolSelect={setCurrentTool}
          currentColor={currentColor}
          onColorChange={setCurrentColor}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          opacity={opacity}
          onOpacityChange={setOpacity}
          isFilledShape={isFilledShape}
          onToggleFilledShape={() => setIsFilledShape(!isFilledShape)}
          canUndo={myUndoStack.length > 0}
          canRedo={myRedoStack.length > 0}
          onUndo={undo}
          onRedo={redo}
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
        />

        {/* Right Live Chat & Online Users Panel */}
        <ChatPanel
          currentUser={currentUser}
          messages={messages}
          onlineUsers={onlineUsers}
          mutedUsers={mutedUsers}
          blockedUsers={blockedUsers}
          onSendMessage={sendMessage}
          onToggleMute={toggleMuteUser}
          onToggleBlock={toggleBlockUser}
          onOpenReport={(user, contextId) =>
            setReportModalData({ isOpen: true, targetUser: user, contextId })
          }
          isOpen={isChatOpen}
          onToggleOpen={() => setIsChatOpen(!isChatOpen)}
        />
      </div>

      {/* Clear Canvas Modal */}
      <ClearModal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirmClear={clearCanvas}
      />

      {/* User Report Modal */}
      <ReportModal
        isOpen={reportModalData.isOpen}
        onClose={() => setReportModalData({ isOpen: false, targetUser: null })}
        targetUser={reportModalData.targetUser}
        contextId={reportModalData.contextId}
        onSubmitReport={submitReport}
      />
    </div>
  );
}
