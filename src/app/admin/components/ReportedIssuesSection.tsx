/**
 * Component: Admin Reported Issues Section
 * Documentation: documentation/backend/services/reported-issues.md
 *
 * Displays open reported issues on the admin dashboard.
 * Allows dismiss or search-for-replacement actions.
 */

'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '@/components/ui/Toast';
import { formatDistanceToNow } from 'date-fns';
import { InteractiveTorrentSearchModal } from '@/components/requests/InteractiveTorrentSearchModal';
import { fetchJSON } from '@/lib/utils/api';
import { mutate } from 'swr';
import type { ReportedIssue } from '@/lib/types/reported-issues';

const reportLabels: Record<ReportedIssue['kind'], string> = {
  audiobook: 'Audio',
  ebook: 'Ebook',
  general: 'General / not sure',
  unknown: 'Unknown report type',
};

const canReplaceReport = (issue: ReportedIssue) => issue.canReplace === true
  && issue.kind === 'audiobook' && issue.target?.type === 'audiobook' && !!issue.audiobook;

interface ReportedIssuesSectionProps {
  issues: ReportedIssue[];
}

export function ReportedIssuesSection({ issues }: ReportedIssuesSectionProps) {
  const toast = useToast();
  const [loadingStates, setLoadingStates] = useState<Record<string, boolean>>({});
  const [replaceIssueId, setReplaceIssueId] = useState<string | null>(null);
  const replaceIssue = issues.find((issue) => issue.id === replaceIssueId && canReplaceReport(issue));

  const handleDismiss = async (issueId: string) => {
    setLoadingStates((prev) => ({ ...prev, [issueId]: true }));

    try {
      await fetchJSON(`/api/admin/reported-issues/${issueId}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ action: 'dismiss' }),
      });

      toast.success('Issue dismissed');
      await mutate((key: unknown) => typeof key === 'string' && key.includes('/api/admin/reported-issues'));
    } catch (error) {
      toast.error(
        `Failed to dismiss issue: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoadingStates((prev) => ({ ...prev, [issueId]: false }));
    }
  };

  const handleReplaceSuccess = async () => {
    toast.success('Replacement download started');
    setReplaceIssueId(null);
    await mutate((key: unknown) => typeof key === 'string' && key.includes('/api/admin/reported-issues'));
    await mutate((key: unknown) => typeof key === 'string' && key.includes('/api/admin/metrics'));
  };

  return (
    <>
      <div className="mb-8">
        {/* Section Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <svg
              className="w-6 h-6 text-orange-600 dark:text-orange-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
              />
            </svg>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Reported Issues
            </h2>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
            {issues.length}
          </span>
        </div>

        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Dismiss closes a report without changing files.</p>

        {/* Issues Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {issues.map((issue) => {
            const isLoading = loadingStates[issue.id] || false;
            const title = issue.book?.title || issue.audiobook?.title || 'No book specified';
            const author = issue.book?.author || issue.audiobook?.author;
            const canReplace = canReplaceReport(issue);
            const targetLabel = issue.target ? 'Audio target linked' : issue.kind === 'general' ? 'No media target' : 'Unresolved target';

            return (
              <div
                key={issue.id}
                className="bg-white dark:bg-gray-800 border-2 border-orange-200 dark:border-orange-800 rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden"
              >
                {/* Card Content */}
                <div className="p-4">
                  <div className="flex gap-3">
                    {/* Cover Image */}
                    <div className="flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={issue.book?.coverArtUrl || issue.audiobook?.coverArtUrl || '/placeholder_cover.svg'}
                        alt=""
                        className="w-16 h-16 rounded object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder_cover.svg'; }}
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 break-words">
                        {title}
                      </h3>
                      {author && <p className="text-sm text-gray-600 dark:text-gray-400 break-words">{author}</p>}
                      <p className="mt-1 text-xs font-medium text-orange-700 dark:text-orange-300">
                        {reportLabels[issue.kind] || reportLabels.unknown}
                        {issue.kind === 'ebook' && ` · ${issue.ebookFormat === 'epub' ? 'EPUB' : issue.ebookFormat === 'pdf' ? 'PDF' : 'Format not sure'}`}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{targetLabel}</p>

                      {/* Reporter */}
                      <div className="flex items-center gap-2 mt-2">
                        {issue.reporter.avatarUrl ? (
                          <img
                            src={issue.reporter.avatarUrl}
                            alt={issue.reporter.plexUsername}
                            className="w-5 h-5 rounded-full"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-gray-600 dark:text-gray-400"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                        )}
                        <span className="text-xs text-gray-600 dark:text-gray-400">
                          {issue.reporter.plexUsername}
                        </span>
                      </div>

                      {/* Timestamp */}
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  {/* Reason */}
                  <p tabIndex={0} aria-label="Reported problem" className="mt-3 max-h-48 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words bg-orange-50 dark:bg-orange-900/20 rounded-lg px-3 py-2 border border-orange-100 dark:border-orange-800/50">
                    {issue.reason}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="border-t border-orange-200 dark:border-orange-800 bg-gray-50 dark:bg-gray-900/50 px-4 py-3 flex gap-2">
                  <button
                    onClick={() => handleDismiss(issue.id)}
                    disabled={isLoading}
                    title="Close this report without changing files"
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    {isLoading ? (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <span>Dismiss</span>
                  </button>

                  {canReplace && (
                    <button
                      onClick={() => setReplaceIssueId(issue.id)}
                      disabled={isLoading}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span>Replace</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive Search Modal for Replacement */}
      {replaceIssue?.audiobook && createPortal(
        <div className="fixed inset-0 z-[60]">
          <InteractiveTorrentSearchModal
            isOpen={!!replaceIssue}
            onClose={() => setReplaceIssueId(null)}
            onSuccess={handleReplaceSuccess}
            audiobook={{
              title: replaceIssue.audiobook.title,
              author: replaceIssue.audiobook.author,
            }}
            asin={replaceIssue.target?.asin || replaceIssue.audiobook.audibleAsin || undefined}
            replaceIssueId={replaceIssue.id}
          />
        </div>,
        document.body
      )}
    </>
  );
}
