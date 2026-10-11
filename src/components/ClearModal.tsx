import React, { useState } from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';

interface ClearModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmClear: () => Promise<any>;
}

export function ClearModal({ isOpen, onClose, onConfirmClear }: ClearModalProps) {
  const [clearing, setClearing] = useState(false);

  if (!isOpen) return null;

  const handleClear = async () => {
    setClearing(true);
    try {
      await onConfirmClear();
    } finally {
      setClearing(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-750 rounded-2xl shadow-2xl overflow-hidden text-zinc-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-red-950/60 border border-red-800/40 text-red-400">
              <Trash2 className="w-4 h-4" />
            </div>
            <h3 className="font-semibold text-sm">Clear Canvas</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-950/20 border border-amber-900/40 text-amber-300 text-xs leading-relaxed">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
            <span>
              Are you sure? This will wipe the shared artwork for <strong>all connected artists</strong> in real time.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={clearing}
              className="px-4 py-2 text-xs font-medium rounded-xl text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing}
              className="px-4 py-2 text-xs font-medium rounded-xl bg-red-600 hover:bg-red-500 text-white transition-colors flex items-center gap-1.5 shadow-lg shadow-red-950/50"
            >
              {clearing ? 'Clearing...' : 'Yes, Clear Canvas'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
