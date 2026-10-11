import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Stroke,
  ToolType,
  Point,
  ShapeData,
  RemoteCursor,
  CanvasSnapshot,
} from '../types.js';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  screenToCanvas,
  renderStroke,
  floodFill,
} from '../lib/canvas-utils.js';

interface CanvasProps {
  currentTool: ToolType;
  currentColor: string;
  brushSize: number;
  opacity: number;
  isFilledShape: boolean;
  currentUser: { userId: string; username: string; userColor: string };
  strokes: Stroke[];
  snapshot: CanvasSnapshot | null;
  remoteCursors: Map<string, RemoteCursor>;
  liveRemoteStrokes: Map<string, Partial<Stroke>>;
  blockedUsers: Set<string>;
  zoom: number;
  pan: { x: number; y: number };
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void;
  onCommitStroke: (stroke: Stroke) => void;
  onBroadcastCursor: (x: number, y: number, tool: ToolType, isDrawing: boolean) => void;
  onBroadcastLiveStroke: (stroke: Partial<Stroke> & { id: string }) => void;
  onSaveSnapshot: (dataUrl: string, strokeCount: number) => void;
}

export function Canvas({
  currentTool,
  currentColor,
  brushSize,
  opacity,
  isFilledShape,
  currentUser,
  strokes,
  snapshot,
  remoteCursors,
  liveRemoteStrokes,
  blockedUsers,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
  onCommitStroke,
  onBroadcastCursor,
  onBroadcastLiveStroke,
  onSaveSnapshot,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Active drawing state
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const isSpacePressedRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentPointsRef = useRef<Point[]>([]);
  const currentStrokeIdRef = useRef<string>('');
  const shapeStartRef = useRef<Point | null>(null);
  const lastLiveBroadcastRef = useRef<number>(0);

  // Eraser hover cursor position in screen coordinates
  const [eraserCursorPos, setEraserCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Eraser size: calibrated for comfortable doodle and ink erasing
  const effectiveEraserSize = Math.max(28, brushSize * 2.5);

  // Space key tracker for canvas panning
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        isSpacePressedRef.current = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Inline text tool state
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const textInputRef = useRef<HTMLInputElement | null>(null);

  // Periodic snapshot trigger
  const lastSnapshotStrokeCount = useRef(0);
  useEffect(() => {
    const validCount = strokes.filter(s => !s.isUndone).length;
    if (validCount > 0 && validCount - lastSnapshotStrokeCount.current >= 50) {
      lastSnapshotStrokeCount.current = validCount;
      if (baseCanvasRef.current) {
        const dataUrl = baseCanvasRef.current.toDataURL('image/png', 0.85);
        onSaveSnapshot(dataUrl, validCount);
      }
    }
  }, [strokes, onSaveSnapshot]);

  // 1. Redraw Base Canvas whenever strokes or snapshot change
  useEffect(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Completely clear base canvas
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Render snapshot image if available
    if (snapshot && snapshot.dataUrl) {
      const img = new Image();
      img.src = snapshot.dataUrl;
      img.onload = () => {
        ctx.drawImage(img, 0, 0);
        renderAllStrokes(ctx);
      };
      return;
    }

    renderAllStrokes(ctx);

    function renderAllStrokes(c: CanvasRenderingContext2D) {
      for (const stroke of strokes) {
        if (stroke.isUndone) continue;
        if (blockedUsers.has(stroke.userId)) continue;
        renderStroke(c, stroke);
      }
    }
  }, [strokes, snapshot, blockedUsers]);

  // 2. Redraw Preview Canvas for in-progress drawing and remote live strokes
  const redrawPreview = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw remote live strokes
    liveRemoteStrokes.forEach((remoteStroke, remoteUserId) => {
      if (blockedUsers.has(remoteUserId)) return;
      if (remoteStroke.id && remoteStroke.points && remoteStroke.points.length > 0) {
        if (remoteStroke.tool === 'eraser') {
          // Live remote eraser directly cuts ink on base canvas
          const baseCanvas = baseCanvasRef.current;
          if (baseCanvas) {
            const baseCtx = baseCanvas.getContext('2d');
            if (baseCtx) renderStroke(baseCtx, remoteStroke as Stroke);
          }
        } else {
          renderStroke(ctx, remoteStroke as Stroke);
        }
      }
    });

    // Draw local active stroke on preview canvas
    if (isDrawingRef.current) {
      if (currentTool === 'eraser') {
        // Eraser preview indicator
        if (currentPointsRef.current.length > 0) {
          const lastPt = currentPointsRef.current[currentPointsRef.current.length - 1];
          ctx.save();
          ctx.beginPath();
          ctx.arc(lastPt.x, lastPt.y, effectiveEraserSize / 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.restore();
        }
      } else if (['pen', 'brush'].includes(currentTool)) {
        if (currentPointsRef.current.length > 0) {
          const activeStroke: Stroke = {
            id: currentStrokeIdRef.current,
            userId: currentUser.userId,
            username: currentUser.username,
            tool: currentTool,
            color: currentColor,
            size: brushSize,
            opacity,
            points: currentPointsRef.current,
            createdAt: Date.now(),
          };
          renderStroke(ctx, activeStroke);
        }
      } else if (['rectangle', 'circle', 'triangle', 'line', 'arrow'].includes(currentTool)) {
        if (shapeStartRef.current && currentPointsRef.current.length > 0) {
          const currentPoint = currentPointsRef.current[currentPointsRef.current.length - 1];
          const shapeData: ShapeData = {
            startX: shapeStartRef.current.x,
            startY: shapeStartRef.current.y,
            endX: currentPoint.x,
            endY: currentPoint.y,
            filled: isFilledShape,
          };
          const activeStroke: Stroke = {
            id: currentStrokeIdRef.current,
            userId: currentUser.userId,
            username: currentUser.username,
            tool: currentTool,
            color: currentColor,
            size: brushSize,
            opacity,
            points: [shapeStartRef.current, currentPoint],
            shapeData,
            createdAt: Date.now(),
          };
          renderStroke(ctx, activeStroke);
        }
      }
    }
  }, [
    liveRemoteStrokes,
    blockedUsers,
    currentTool,
    currentColor,
    brushSize,
    effectiveEraserSize,
    opacity,
    isFilledShape,
    currentUser,
  ]);

  useEffect(() => {
    redrawPreview();
  }, [redrawPreview, liveRemoteStrokes]);

  // Handle Zoom with mouse wheel or trackpad
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.25), 3.5);

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const canvasX = (mouseX - pan.x) / zoom;
        const canvasY = (mouseY - pan.y) / zoom;

        onPanChange({
          x: mouseX - canvasX * newZoom,
          y: mouseY - canvasY * newZoom,
        });
      }
      onZoomChange(newZoom);
    } else {
      // Pan canvas
      onPanChange(prev => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || isSpacePressedRef.current || currentTool === 'pan') {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }

    if (e.button !== 0) return; // Only primary mouse button

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const canvasPt = screenToCanvas(e.clientX, e.clientY, rect, zoom, pan);

    // Flood fill tool executes immediately on click
    if (currentTool === 'fill') {
      const baseCanvas = baseCanvasRef.current;
      if (baseCanvas) {
        const ctx = baseCanvas.getContext('2d');
        if (ctx) {
          floodFill(ctx, canvasPt.x, canvasPt.y, currentColor, opacity);
          const stroke: Stroke = {
            id: 'fill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            userId: currentUser.userId,
            username: currentUser.username,
            tool: 'fill',
            color: currentColor,
            size: brushSize,
            opacity,
            points: [canvasPt],
            shapeData: { startX: canvasPt.x, startY: canvasPt.y, endX: canvasPt.x, endY: canvasPt.y },
            createdAt: Date.now(),
          };
          onCommitStroke(stroke);
        }
      }
      return;
    }

    // Text tool: open floating inline input
    if (currentTool === 'text') {
      setTextInputPos({
        x: e.clientX,
        y: e.clientY,
        canvasX: canvasPt.x,
        canvasY: canvasPt.y,
      });
      setTextInputValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
      return;
    }

    // Start drawing
    isDrawingRef.current = true;
    currentStrokeIdRef.current = 'strk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    shapeStartRef.current = canvasPt;
    currentPointsRef.current = [canvasPt];

    // IF ERASING: Execute instant erase on base canvas at clicked point!
    if (currentTool === 'eraser') {
      const baseCanvas = baseCanvasRef.current;
      if (baseCanvas) {
        const baseCtx = baseCanvas.getContext('2d');
        if (baseCtx) {
          baseCtx.save();
          baseCtx.globalCompositeOperation = 'destination-out';
          baseCtx.beginPath();
          baseCtx.arc(canvasPt.x, canvasPt.y, effectiveEraserSize / 2, 0, Math.PI * 2);
          baseCtx.fill();
          baseCtx.restore();
        }
      }
    }

    onBroadcastCursor(canvasPt.x, canvasPt.y, currentTool, true);
    redrawPreview();
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (currentTool === 'eraser') {
      setEraserCursorPos({ x: e.clientX, y: e.clientY });
    } else if (eraserCursorPos) {
      setEraserCursorPos(null);
    }

    if (isPanningRef.current) {
      onPanChange({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      });
      return;
    }

    const canvasPt = screenToCanvas(e.clientX, e.clientY, rect, zoom, pan);

    // Broadcast cursor position
    onBroadcastCursor(canvasPt.x, canvasPt.y, currentTool, isDrawingRef.current);

    if (!isDrawingRef.current) return;

    currentPointsRef.current.push(canvasPt);

    // If erasing, execute instant real-time erase on base canvas
    if (currentTool === 'eraser') {
      const baseCanvas = baseCanvasRef.current;
      if (baseCanvas) {
        const baseCtx = baseCanvas.getContext('2d');
        if (baseCtx && currentPointsRef.current.length >= 2) {
          const pts = currentPointsRef.current;
          const p1 = pts[pts.length - 2];
          const p2 = pts[pts.length - 1];
          baseCtx.save();
          baseCtx.globalCompositeOperation = 'destination-out';
          baseCtx.lineCap = 'round';
          baseCtx.lineJoin = 'round';
          baseCtx.lineWidth = effectiveEraserSize;
          baseCtx.beginPath();
          baseCtx.moveTo(p1.x, p1.y);
          baseCtx.lineTo(p2.x, p2.y);
          baseCtx.stroke();
          baseCtx.restore();
        }
      }
    }

    redrawPreview();

    // Throttled live broadcast for real-time smoothness
    const now = Date.now();
    if (now - lastLiveBroadcastRef.current > 40) {
      lastLiveBroadcastRef.current = now;

      if (['pen', 'brush', 'eraser'].includes(currentTool)) {
        onBroadcastLiveStroke({
          id: currentStrokeIdRef.current,
          tool: currentTool,
          color: currentColor,
          size: currentTool === 'eraser' ? effectiveEraserSize : brushSize,
          opacity,
          points: currentPointsRef.current,
        });
      } else if (['rectangle', 'circle', 'triangle', 'line', 'arrow'].includes(currentTool)) {
        if (shapeStartRef.current) {
          onBroadcastLiveStroke({
            id: currentStrokeIdRef.current,
            tool: currentTool,
            color: currentColor,
            size: brushSize,
            opacity,
            points: [shapeStartRef.current, canvasPt],
            shapeData: {
              startX: shapeStartRef.current.x,
              startY: shapeStartRef.current.y,
              endX: canvasPt.x,
              endY: canvasPt.y,
              filled: isFilledShape,
            },
          });
        }
      }
    }
  };

  // Pointer Up / Commit Stroke
  const handlePointerUp = () => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const points = currentPointsRef.current;
    if (points.length === 0) return;

    let finalShapeData: ShapeData | undefined = undefined;
    if (['rectangle', 'circle', 'triangle', 'line', 'arrow'].includes(currentTool) && shapeStartRef.current) {
      const lastPt = points[points.length - 1];
      finalShapeData = {
        startX: shapeStartRef.current.x,
        startY: shapeStartRef.current.y,
        endX: lastPt.x,
        endY: lastPt.y,
        filled: isFilledShape,
      };
    }

    const stroke: Stroke = {
      id: currentStrokeIdRef.current,
      userId: currentUser.userId,
      username: currentUser.username,
      tool: currentTool,
      color: currentTool === 'eraser' ? '#000000' : currentColor,
      size: currentTool === 'eraser' ? effectiveEraserSize : brushSize,
      opacity,
      points,
      shapeData: finalShapeData,
      createdAt: Date.now(),
    };

    onCommitStroke(stroke);

    currentPointsRef.current = [];
    shapeStartRef.current = null;
    redrawPreview();
  };

  // Commit Inline Text
  const handleCommitText = () => {
    if (!textInputPos || !textInputValue.trim()) {
      setTextInputPos(null);
      return;
    }

    const stroke: Stroke = {
      id: 'txt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      userId: currentUser.userId,
      username: currentUser.username,
      tool: 'text',
      color: currentColor,
      size: brushSize,
      opacity,
      points: [{ x: textInputPos.canvasX, y: textInputPos.canvasY }],
      shapeData: {
        startX: textInputPos.canvasX,
        startY: textInputPos.canvasY,
        endX: textInputPos.canvasX,
        endY: textInputPos.canvasY,
        text: textInputValue.trim(),
      },
      createdAt: Date.now(),
    };

    onCommitStroke(stroke);
    setTextInputPos(null);
    setTextInputValue('');
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none bg-zinc-950 touch-none"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setEraserCursorPos(null)}
      style={{
        cursor:
          currentTool === 'pan'
            ? isPanningRef.current
              ? 'grabbing'
              : 'grab'
            : currentTool === 'eraser'
            ? 'none'
            : 'crosshair',
      }}
    >
      {/* Floating Eraser Ring Cursor */}
      {currentTool === 'eraser' && eraserCursorPos && (
        <div
          className="fixed pointer-events-none rounded-full border-2 border-white/80 bg-white/10 shadow-lg z-50 -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
          style={{
            left: eraserCursorPos.x,
            top: eraserCursorPos.y,
            width: effectiveEraserSize * zoom,
            height: effectiveEraserSize * zoom,
          }}
        />
      )}

      {/* Transformed Canvas Container */}
      <div
        className="absolute origin-top-left will-change-transform"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
        }}
      >
        {/* Background Board with Canvas Dots */}
        <div
          className="absolute inset-0 rounded-sm shadow-2xl pointer-events-none"
          style={{
            backgroundColor: '#0f1115',
            backgroundImage: 'radial-gradient(#1e222b 1.5px, transparent 1.5px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Base Canvas (Committed Drawings on Transparent Layer) */}
        <canvas
          ref={baseCanvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0 rounded-sm"
        />

        {/* Preview Canvas (Active Drawing & Remote Live Strokes) */}
        <canvas
          ref={previewCanvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0 pointer-events-none"
        />

        {/* Remote Live Cursors Overlay */}
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          {Array.from(remoteCursors.values()).map(cursor => {
            if (blockedUsers.has(cursor.userId)) return null;
            return (
              <div
                key={cursor.userId}
                className="absolute transition-transform duration-75 ease-out pointer-events-none z-30"
                style={{
                  transform: `translate(${cursor.x}px, ${cursor.y}px)`,
                }}
              >
                {/* Minimalist Cursor Icon */}
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="drop-shadow-md"
                  style={{ color: cursor.userColor }}
                >
                  <path
                    d="M3 3l7 18 3-7 7-3L3 3z"
                    fill={cursor.userColor}
                    stroke="#18181b"
                    strokeWidth="1.5"
                  />
                </svg>

                {/* User Tag */}
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium tracking-tight text-white whitespace-nowrap shadow-lg border border-white/10 ml-3 -mt-2 backdrop-blur-sm"
                  style={{ backgroundColor: `${cursor.userColor}dd` }}
                >
                  <span className="truncate max-w-[120px]">{cursor.username}</span>
                  {cursor.isDrawing && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  )}
                  <span className="text-[9px] opacity-80 uppercase font-mono">
                    {cursor.tool}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inline Text Tool Input Popover */}
      {textInputPos && (
        <div
          className="absolute z-50 bg-zinc-900 border border-zinc-700 p-2 rounded-lg shadow-2xl flex items-center gap-2"
          style={{
            left: Math.min(window.innerWidth - 300, Math.max(10, textInputPos.x)),
            top: Math.min(window.innerHeight - 80, Math.max(10, textInputPos.y)),
          }}
          onClick={e => e.stopPropagation()}
        >
          <input
            ref={textInputRef}
            type="text"
            value={textInputValue}
            onChange={e => setTextInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCommitText();
              if (e.key === 'Escape') setTextInputPos(null);
            }}
            placeholder="Type text and press Enter..."
            className="bg-zinc-950 text-zinc-100 text-sm px-2.5 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-zinc-500 w-52"
          />
          <button
            onClick={handleCommitText}
            className="px-2.5 py-1.5 text-xs font-medium rounded bg-zinc-100 text-zinc-900 hover:bg-white transition-colors"
          >
            Place
          </button>
          <button
            onClick={() => setTextInputPos(null)}
            className="px-2 py-1.5 text-xs font-medium rounded text-zinc-400 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
