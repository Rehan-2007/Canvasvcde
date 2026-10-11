import React, { useState } from 'react';
import {
  Pen,
  Paintbrush,
  Eraser,
  Square,
  Circle,
  Triangle,
  Minus,
  MoveRight,
  Type,
  PaintBucket,
  Hand,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronDown,
} from 'lucide-react';
import { ToolType } from '../types.js';
import { PALETTE, BRUSH_SIZES } from '../lib/colors.js';

interface ToolbarProps {
  currentTool: ToolType;
  onToolSelect: (tool: ToolType) => void;
  currentColor: string;
  onColorChange: (color: string) => void;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  isFilledShape: boolean;
  onToggleFilledShape: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
}

export function Toolbar({
  currentTool,
  onToolSelect,
  currentColor,
  onColorChange,
  brushSize,
  onBrushSizeChange,
  opacity,
  onOpacityChange,
  isFilledShape,
  onToggleFilledShape,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: ToolbarProps) {
  const [showShapesMenu, setShowShapesMenu] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);

  const shapes: { type: ToolType; label: string; icon: React.ReactNode }[] = [
    { type: 'rectangle', label: 'Rectangle', icon: <Square className="w-4 h-4" /> },
    { type: 'circle', label: 'Circle', icon: <Circle className="w-4 h-4" /> },
    { type: 'triangle', label: 'Triangle', icon: <Triangle className="w-4 h-4" /> },
    { type: 'line', label: 'Line', icon: <Minus className="w-4 h-4" /> },
    { type: 'arrow', label: 'Arrow', icon: <MoveRight className="w-4 h-4" /> },
  ];

  const isShapeTool = shapes.some(s => s.type === currentTool);

  return (
    <aside
      aria-label="Drawing Tools"
      className="absolute top-16 left-3 z-40 flex flex-col gap-2 p-1.5 bg-zinc-900/90 backdrop-blur-md border border-zinc-800 rounded-xl shadow-2xl text-zinc-300 w-12 sm:w-14 items-center"
    >
      {/* Primary Drawing Tools */}
      <div className="flex flex-col gap-1 w-full items-center">
        {/* Pen */}
        <button
          onClick={() => onToolSelect('pen')}
          title="Pen (P)"
          className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${
            currentTool === 'pen'
              ? 'bg-zinc-800 text-zinc-100 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <Pen className="w-4 h-4" />
        </button>

        {/* Brush */}
        <button
          onClick={() => onToolSelect('brush')}
          title="Calligraphy Brush (B)"
          className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${
            currentTool === 'brush'
              ? 'bg-zinc-800 text-zinc-100 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <Paintbrush className="w-4 h-4" />
        </button>

        {/* Eraser */}
        <button
          onClick={() => onToolSelect('eraser')}
          title="Eraser (E)"
          className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${
            currentTool === 'eraser'
              ? 'bg-zinc-800 text-zinc-100 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <Eraser className="w-4 h-4" />
        </button>

        {/* Shapes Dropdown */}
        <div className="relative w-full flex justify-center">
          <button
            onClick={() => setShowShapesMenu(!showShapesMenu)}
            title="Shapes"
            className={`p-2.5 rounded-lg transition-colors flex items-center justify-center relative ${
              isShapeTool
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
            }`}
          >
            {currentTool === 'circle' ? (
              <Circle className="w-4 h-4" />
            ) : currentTool === 'triangle' ? (
              <Triangle className="w-4 h-4" />
            ) : currentTool === 'line' ? (
              <Minus className="w-4 h-4" />
            ) : currentTool === 'arrow' ? (
              <MoveRight className="w-4 h-4" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            <ChevronDown className="w-2.5 h-2.5 absolute bottom-1 right-1 opacity-60" />
          </button>

          {showShapesMenu && (
            <div
              className="absolute left-full top-0 ml-2.5 p-2 bg-zinc-900 border border-zinc-750 rounded-xl shadow-2xl flex flex-col gap-1 z-50 min-w-[130px]"
              onMouseLeave={() => setShowShapesMenu(false)}
            >
              <div className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase px-2 py-0.5">
                Geometric
              </div>
              {shapes.map(s => (
                <button
                  key={s.type}
                  onClick={() => {
                    onToolSelect(s.type);
                    setShowShapesMenu(false);
                  }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    currentTool === s.type
                      ? 'bg-zinc-800 text-zinc-100 font-medium'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  {s.icon}
                  <span>{s.label}</span>
                </button>
              ))}

              <div className="border-t border-zinc-800 mt-1 pt-1.5 px-2 flex items-center justify-between text-xs text-zinc-400">
                <span>Fill shape</span>
                <input
                  type="checkbox"
                  checked={isFilledShape}
                  onChange={onToggleFilledShape}
                  className="rounded bg-zinc-800 border-zinc-700 text-zinc-100 focus:ring-0 cursor-pointer accent-zinc-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Text */}
        <button
          onClick={() => onToolSelect('text')}
          title="Text Tool (T)"
          className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${
            currentTool === 'text'
              ? 'bg-zinc-800 text-zinc-100 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <Type className="w-4 h-4" />
        </button>

        {/* Fill (Bucket) */}
        <button
          onClick={() => onToolSelect('fill')}
          title="Bucket Fill (F)"
          className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${
            currentTool === 'fill'
              ? 'bg-zinc-800 text-zinc-100 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <PaintBucket className="w-4 h-4" />
        </button>

        {/* Pan Hand */}
        <button
          onClick={() => onToolSelect('pan')}
          title="Hand / Pan Canvas (H or hold Space)"
          className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${
            currentTool === 'pan'
              ? 'bg-zinc-800 text-zinc-100 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          <Hand className="w-4 h-4" />
        </button>
      </div>

      <div className="w-7 h-[1px] bg-zinc-800 my-0.5" />

      {/* Color Selector Popover Button */}
      <div className="relative">
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          title="Color Palette"
          className="p-1 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-all flex items-center justify-center"
        >
          <div
            className="w-5 h-5 rounded-md shadow-sm border border-black/40"
            style={{ backgroundColor: currentColor }}
          />
        </button>

        {showColorPicker && (
          <div
            className="absolute left-full top-0 ml-2.5 p-3 bg-zinc-900 border border-zinc-750 rounded-xl shadow-2xl z-50 min-w-[210px]"
            onMouseLeave={() => setShowColorPicker(false)}
          >
            <div className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase mb-2">
              Palette
            </div>
            <div className="grid grid-cols-7 gap-1.5 mb-3">
              {PALETTE.map(color => (
                <button
                  key={color}
                  onClick={() => {
                    onColorChange(color);
                    setShowColorPicker(false);
                  }}
                  className={`w-5 h-5 rounded-md transition-transform ${
                    currentColor.toLowerCase() === color.toLowerCase()
                      ? 'scale-110 ring-2 ring-zinc-300 ring-offset-1 ring-offset-zinc-900'
                      : 'hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800">
              <span className="text-xs text-zinc-400">Hex</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={currentColor}
                  onChange={e => onColorChange(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                />
                <input
                  type="text"
                  value={currentColor}
                  onChange={e => onColorChange(e.target.value)}
                  className="w-16 bg-zinc-950 text-zinc-200 text-[11px] font-mono px-1.5 py-0.5 rounded border border-zinc-700"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Brush Size & Opacity Popover Button */}
      <div className="relative">
        <button
          onClick={() => setShowSizePicker(!showSizePicker)}
          title={`Size: ${brushSize}px | Opacity: ${Math.round(opacity * 100)}%`}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors flex items-center justify-center"
        >
          <div
            className="rounded-full bg-zinc-300"
            style={{
              width: Math.min(16, Math.max(3, brushSize / 2.5)),
              height: Math.min(16, Math.max(3, brushSize / 2.5)),
            }}
          />
        </button>

        {showSizePicker && (
          <div
            className="absolute left-full top-0 ml-2.5 p-3 bg-zinc-900 border border-zinc-750 rounded-xl shadow-2xl z-50 min-w-[200px]"
            onMouseLeave={() => setShowSizePicker(false)}
          >
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-1.5">
              <span>Size</span>
              <span className="font-mono text-zinc-200">{brushSize}px</span>
            </div>
            <input
              type="range"
              min="1"
              max="72"
              value={brushSize}
              onChange={e => onBrushSizeChange(Number(e.target.value))}
              className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-zinc-200 mb-3"
            />

            <div className="flex items-center justify-between gap-1 mb-3">
              {BRUSH_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => onBrushSizeChange(s)}
                  className={`w-5 h-5 rounded flex items-center justify-center text-[10px] ${
                    brushSize === s
                      ? 'bg-zinc-800 text-zinc-100 font-bold border border-zinc-600'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="border-t border-zinc-800 pt-2">
              <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
                <span>Opacity</span>
                <span className="font-mono text-zinc-200">{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={opacity}
                onChange={e => onOpacityChange(Number(e.target.value))}
                className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-zinc-200"
              />
            </div>
          </div>
        )}
      </div>

      <div className="w-7 h-[1px] bg-zinc-800 my-0.5" />

      {/* Undo & Redo (User's own strokes) */}
      <div className="flex flex-col gap-1 w-full items-center">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo your stroke (Ctrl+Z)"
          className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
            canUndo
              ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              : 'text-zinc-700 cursor-not-allowed'
          }`}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo your stroke (Ctrl+Y)"
          className={`p-2 rounded-lg transition-colors flex items-center justify-center ${
            canRedo
              ? 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              : 'text-zinc-700 cursor-not-allowed'
          }`}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="w-7 h-[1px] bg-zinc-800 my-0.5" />

      {/* Zoom Controls */}
      <div className="flex flex-col gap-1 w-full items-center">
        <button
          onClick={onZoomIn}
          title="Zoom In"
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onResetZoom}
          title={`Reset Zoom: ${Math.round(zoom * 100)}%`}
          className="text-[10px] font-mono text-zinc-400 hover:text-zinc-200 px-1 py-0.5 rounded hover:bg-zinc-800"
        >
          {Math.round(zoom * 100)}%
        </button>

        <button
          onClick={onZoomOut}
          title="Zoom Out"
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={onResetZoom}
          title="Fit Canvas"
          className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
}
