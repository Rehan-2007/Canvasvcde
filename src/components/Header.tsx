import React, { useState } from 'react';
import {
  Brush,
  Download,
  Trash2,
  Shield,
  Edit2,
  Check,
  Share2,
  FileCode2,
  Image as ImageIcon,
} from 'lucide-react';
import { ConnectionStatus, OnlineUser } from '../types.js';

interface HeaderProps {
  currentUser: { userId: string; username: string; userColor: string; isModerator?: boolean };
  onUpdateUsername: (newName: string) => void;
  connectionStatus: ConnectionStatus;
  onlineCount: number;
  onOpenClearModal: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
}

export function Header({
  currentUser,
  onUpdateUsername,
  connectionStatus,
  onlineCount,
  onOpenClearModal,
  onExportPNG,
  onExportSVG,
}: HeaderProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(currentUser.username);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const handleSaveName = () => {
    if (nameInput.trim()) {
      onUpdateUsername(nameInput.trim());
      setIsEditingName(false);
    }
  };

  return (
    <header className="h-12 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between z-30 select-none">
      {/* Brand & Connection Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-100 shadow-inner">
            <Brush className="w-4 h-4 text-zinc-200" />
          </div>
          <span className="font-semibold text-sm tracking-tight text-zinc-100">
            CollabCanvas
          </span>
        </div>

        <div className="h-4 w-[1px] bg-zinc-800 hidden sm:block" />

        {/* Live Status Indicator */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[11px]">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionStatus.state === 'connected'
                  ? 'bg-emerald-500 animate-pulse'
                  : connectionStatus.state === 'reconnecting'
                  ? 'bg-amber-500 animate-ping'
                  : 'bg-red-500'
              }`}
            />
            <span className="text-zinc-400 capitalize hidden sm:inline">
              {connectionStatus.state === 'connected'
                ? 'Live'
                : connectionStatus.state}
            </span>
          </div>

          <div className="text-zinc-400 text-[11px] hidden md:flex items-center gap-1">
            <span className="font-mono text-zinc-200 font-medium">{onlineCount}</span> online
          </div>
        </div>
      </div>

      {/* User profile & Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* User Identity / Edit */}
        <div className="flex items-center gap-1.5 bg-zinc-900/80 px-2 py-1 rounded-lg border border-zinc-800 text-xs">
          <span
            className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
            style={{ backgroundColor: currentUser.userColor }}
          />

          {isEditingName ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                maxLength={24}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
                className="bg-zinc-950 text-zinc-100 px-1.5 py-0.5 rounded text-xs border border-zinc-700 w-28 focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleSaveName}
                className="text-emerald-400 hover:text-emerald-300 p-0.5"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="font-medium text-zinc-300 text-xs truncate max-w-[100px] sm:max-w-[140px]">
                {currentUser.username}
              </span>
              <button
                onClick={() => {
                  setNameInput(currentUser.username);
                  setIsEditingName(true);
                }}
                title="Change username"
                className="text-zinc-500 hover:text-zinc-300 p-0.5"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Clear Canvas */}
        <button
          onClick={onOpenClearModal}
          title="Clear shared canvas for all artists"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg text-zinc-300 hover:text-red-400 hover:bg-zinc-900 border border-zinc-800 hover:border-red-950/60 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Clear</span>
        </button>

        {/* Export Menu */}
        <div className="relative">
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export Artwork"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-100 text-zinc-900 hover:bg-white transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>

          {showExportMenu && (
            <div
              className="absolute right-0 top-full mt-1.5 bg-zinc-900 border border-zinc-750 rounded-xl shadow-2xl p-1 z-50 min-w-[150px]"
              onMouseLeave={() => setShowExportMenu(false)}
            >
              <button
                onClick={() => {
                  onExportPNG();
                  setShowExportMenu(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-zinc-200 hover:bg-zinc-800 rounded-lg text-left"
              >
                <ImageIcon className="w-4 h-4 text-zinc-400" />
                <span>PNG Image</span>
              </button>
              <button
                onClick={() => {
                  onExportSVG();
                  setShowExportMenu(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-xs text-zinc-200 hover:bg-zinc-800 rounded-lg text-left"
              >
                <FileCode2 className="w-4 h-4 text-zinc-400" />
                <span>Vector SVG</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
