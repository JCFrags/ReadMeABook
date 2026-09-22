/**
 * Component: Shared Report Issue Modal
 * Documentation: documentation/frontend/components.md
 *
 * Shared form for audio, ebook, and general problem reports.
 * Rendered via portal above the book details modal.
 */

'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useReportIssue } from '@/lib/hooks/useReportedIssues';
import { REPORT_REASON_MAX_LENGTH, type EbookFormat, type ReportKind } from '@/lib/types/reported-issues';

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  asin?: string;
  bookTitle?: string;
  bookAuthor?: string;
  coverArtUrl?: string;
}

export function ReportIssueModal({
  isOpen,
  onClose,
  asin,
  bookTitle,
  bookAuthor,
  coverArtUrl,
}: ReportIssueModalProps) {
  const { reportIssue, isLoading } = useReportIssue();
  const [kind, setKind] = useState<ReportKind>(asin ? 'audiobook' : 'general');
  const [ebookFormat, setEbookFormat] = useState<EbookFormat>('unknown');
  const [title, setTitle] = useState(bookTitle || '');
  const [author, setAuthor] = useState(bookAuthor || '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const hasBookContext = !!(asin || bookTitle || bookAuthor);
  const canSubmit = reason.trim().length > 0 && reason.length <= REPORT_REASON_MAX_LENGTH
    && (kind !== 'audiobook' || !!asin) && !isLoading;

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (saved) dialogRef.current?.focus();
  }, [saved]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!isLoading) onClose();
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      ':is(button, input, select, textarea):not(:disabled)'
    ) || []).filter((control) => !(control instanceof HTMLInputElement && control.type === 'radio' && !control.checked));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first || !last) {
      event.preventDefault();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    dialogRef.current?.focus();
    try {
      await reportIssue({
        kind,
        reason: reason.trim(),
        asin,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        coverArtUrl,
        ...(kind === 'ebook' ? { ebookFormat } : {}),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save report. Please try again.');
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  const fieldClass = 'w-full px-3.5 py-2.5 bg-gray-50 dark:bg-white/[0.06] rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 disabled:opacity-50';

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 dark:bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(event) => {
        event.stopPropagation();
        if (!isLoading) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-heading`}
        aria-describedby={`${id}-notice`}
        aria-busy={isLoading}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] flex flex-col bg-white dark:bg-gray-800 rounded-2xl shadow-2xl shadow-black/20 overflow-hidden focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id={`${id}-heading`} className="text-lg font-semibold text-gray-900 dark:text-white">
            Report a problem
          </h2>
          <p id={`${id}-notice`} className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Submitting this form saves a report. It does not start ReadMeABook&apos;s Replace action.
          </p>
        </div>

        {saved ? (
          <>
            <div role="status" className="px-5 pb-5 text-sm text-gray-700 dark:text-gray-300">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400">Report saved</p>
              <p className="mt-2">An administrator can review your report.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10"
            >
              Done
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
            <div className="px-5 pb-4 space-y-4 overflow-y-auto overscroll-contain">
              {hasBookContext && (
                <div className="rounded-xl bg-gray-50 dark:bg-white/[0.06] px-3 py-2 text-sm">
                  <p className="font-medium text-gray-900 dark:text-white break-words">{bookTitle || asin || 'Book context'}</p>
                  {bookAuthor && <p className="text-gray-500 dark:text-gray-400 break-words">{bookAuthor}</p>}
                </div>
              )}

              <fieldset disabled={isLoading}>
                <legend className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Report type</legend>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['audiobook', 'Audio'],
                    ['ebook', 'Ebook'],
                    ['general', 'General / not sure'],
                  ] as const).map(([value, label]) => (
                    <label key={value} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 text-sm ${kind === value ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'} ${value === 'audiobook' && !asin ? 'opacity-50' : 'cursor-pointer'}`}>
                      <input
                        type="radio"
                        name={`${id}-kind`}
                        value={value}
                        checked={kind === value}
                        disabled={value === 'audiobook' && !asin}
                        onChange={() => { setKind(value); setError(null); }}
                        className="accent-orange-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {!asin && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    For Audio, open the book&apos;s details. If you cannot identify the book, choose General / not sure and describe it below.
                  </p>
                )}
              </fieldset>

              {kind === 'ebook' && (
                <div>
                  <label htmlFor={`${id}-format`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ebook format</label>
                  <select id={`${id}-format`} value={ebookFormat} onChange={(event) => { setEbookFormat(event.target.value as EbookFormat); setError(null); }} disabled={isLoading} className={fieldClass}>
                    <option value="unknown">Not sure</option>
                    <option value="epub">EPUB</option>
                    <option value="pdf">PDF</option>
                  </select>
                </div>
              )}

              {!hasBookContext && (
                <div className="space-y-3">
                  <div>
                    <label htmlFor={`${id}-title`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Book title (optional)</label>
                    <input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} disabled={isLoading} className={fieldClass} />
                  </div>
                  <div>
                    <label htmlFor={`${id}-author`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Author (optional)</label>
                    <input id={`${id}-author`} value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={500} disabled={isLoading} className={fieldClass} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Leave these blank for a general problem. A library match is not required.</p>
                </div>
              )}

              <div>
                <label htmlFor={`${id}-reason`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Describe the problem</label>
                <textarea
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(event) => { setReason(event.target.value); setError(null); }}
                  placeholder={kind === 'audiobook' ? 'For example: missing chapters, wrong narrator, or damaged audio.' : kind === 'ebook' ? 'For example: missing pages, unreadable text, or the wrong edition.' : 'What happened, and what did you expect? Include any book details that could help.'}
                  rows={4}
                  maxLength={REPORT_REASON_MAX_LENGTH}
                  required
                  disabled={isLoading}
                  aria-describedby={`${id}-count${error ? ` ${id}-error` : ''}`}
                  className={`${fieldClass} resize-y`}
                />
                <p id={`${id}-count`} className="mt-1 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400">{reason.length}/{REPORT_REASON_MAX_LENGTH}</p>
              </div>
              {error && <p id={`${id}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
            </div>

            <div className="flex border-t border-gray-200/80 dark:border-gray-700/50">
              <button type="button" onClick={onClose} disabled={isLoading} className="flex-1 px-4 py-3 text-[15px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03] disabled:opacity-40 border-r border-gray-200/80 dark:border-gray-700/50">
                Cancel
              </button>
              <button type="submit" disabled={!canSubmit} className="flex-1 px-4 py-3 text-[15px] font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 disabled:opacity-40 disabled:cursor-not-allowed">
                {isLoading ? 'Saving...' : 'Submit report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
