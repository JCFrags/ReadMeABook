/**
 * Component: Reported Issues Hooks
 * Documentation: documentation/backend/services/reported-issues.md
 */

'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/contexts/AuthContext';
import { fetchJSON, fetchWithAuth } from '@/lib/utils/api';
import type { ReportIssueInput, ReportedIssue } from '@/lib/types/reported-issues';

const fetcher = (url: string) => fetchJSON(url);

/**
 * Hook for reporting an audio, ebook, or general problem (user action)
 */
export function useReportIssue() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reportIssue = async (input: ReportIssueInput): Promise<ReportedIssue> => {
    if (!accessToken) throw new Error('Please sign in to report a problem.');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth('/api/reported-issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.message || `Failed to save report (HTTP ${response.status}). Please try again.`);
      }
      if (data?.success !== true || typeof data?.issue?.id !== 'string') {
        throw new Error('The server did not confirm that the report was saved. Please check before submitting again.');
      }

      // A refresh failure must not turn a saved report into a submission error.
      void mutate((key) => typeof key === 'string' && (
        key.includes('/api/audiobooks') || key.includes('/api/admin/reported-issues')
      )).catch(() => undefined);

      return data.issue;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { reportIssue, isLoading, error };
}

/**
 * Hook for fetching open reported issues (admin dashboard)
 */
export function useAdminReportedIssues() {
  const { accessToken } = useAuth();

  const endpoint = accessToken ? '/api/admin/reported-issues' : null;

  const { data, error, isLoading } = useSWR<{ issues: ReportedIssue[]; count: number }>(endpoint, fetcher, {
    refreshInterval: 10000,
  });

  return {
    issues: data?.issues || [],
    count: data?.count || 0,
    isLoading,
    error,
  };
}

/**
 * Hook for dismissing a reported issue (admin action)
 */
export function useDismissIssue() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismissIssue = async (issueId: string) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/admin/reported-issues/${issueId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to dismiss issue');
      }

      // Revalidate issues list
      mutate((key) => typeof key === 'string' && key.includes('/api/admin/reported-issues'));

      return data.issue;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { dismissIssue, isLoading, error };
}

/**
 * Hook for replacing audiobook content via reported issue (admin action)
 */
export function useReplaceWithTorrent() {
  const { accessToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replaceWithTorrent = async (issueId: string, torrent: any) => {
    if (!accessToken) throw new Error('Not authenticated');

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchWithAuth(`/api/admin/reported-issues/${issueId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ torrent }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to replace audiobook');
      }

      // Revalidate issues list and audiobook lists
      mutate((key) => typeof key === 'string' && key.includes('/api/admin/reported-issues'));
      mutate((key) => typeof key === 'string' && key.includes('/api/audiobooks'));

      return data.request;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { replaceWithTorrent, isLoading, error };
}
