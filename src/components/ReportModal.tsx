import React, { useState } from 'react';
import { Flag, X, Check } from 'lucide-react';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: { userId: string; username: string } | null;
  contextId?: string;
  onSubmitReport: (
    reportedUserId: string,
    reportedUsername: string,
    reason: string,
    contextType: 'chat' | 'drawing',
    contextId?: string
  ) => Promise<boolean>;
}

const REPORT_REASONS = [
  'Canvas Vandalism / Griefing',
  'Abusive or Harassing Chat',
  'Inappropriate or NSFW Content',
  'Drawing Flooding / Bot Spam',
  'Other',
];

export function ReportModal({
  isOpen,
  onClose,
  targetUser,
  contextId,
  onSubmitReport,
}: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (!isOpen || !targetUser) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    const fullReason = details.trim()
      ? `${selectedReason}: ${details.trim()}`
      : selectedReason;

    const success = await onSubmitReport(
      targetUser.userId,
      targetUser.username,
      fullReason,
      contextId ? 'chat' : 'drawing',
      contextId
    );

    setSubmitting(false);
    if (success) {
      setSubmitted(true);
      setTimeout(() => {
        setSubmitted(false);
        onClose();
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-750 rounded-2xl shadow-2xl overflow-hidden text-zinc-100">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/40">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
              <Flag className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Report User</h3>
              <p className="text-[11px] text-zinc-400">
                Reporting <span className="text-zinc-200 font-medium">{targetUser.username}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted ? (
          <div className="p-8 text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto">
              <Check className="w-5 h-5" />
            </div>
            <h4 className="text-sm font-semibold text-zinc-100">Report Submitted</h4>
            <p className="text-xs text-zinc-400">
              Thank you for keeping CollabCanvas a safe and productive creative space.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
            <div>
              <label className="block text-zinc-300 font-medium mb-1.5">
                Reason for report
              </label>
              <select
                value={selectedReason}
                onChange={e => setSelectedReason(e.target.value)}
                className="w-full bg-zinc-950 text-zinc-200 px-3 py-2 rounded-xl border border-zinc-750 focus:outline-none focus:border-zinc-500"
              >
                {REPORT_REASONS.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-zinc-300 font-medium mb-1.5">
                Additional context (optional)
              </label>
              <textarea
                value={details}
                onChange={e => setDetails(e.target.value)}
                rows={3}
                placeholder="Provide details about the incident..."
                className="w-full bg-zinc-950 text-zinc-200 p-2.5 rounded-xl border border-zinc-750 focus:outline-none focus:border-zinc-500 resize-none text-xs"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium rounded-xl bg-zinc-100 text-zinc-950 hover:bg-white transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
