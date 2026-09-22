/**
 * Component: Reported Issues Presentation Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportedIssuesSection } from '@/app/admin/components/ReportedIssuesSection';
import type { ReportedIssue } from '@/lib/types/reported-issues';

const fetchMock = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/utils/api', () => ({ fetchJSON: fetchMock }));
vi.mock('@/components/ui/Toast', () => ({ useToast: () => toast }));
vi.mock('@/components/requests/InteractiveTorrentSearchModal', () => ({ InteractiveTorrentSearchModal: () => null }));

const issue = (id: string, overrides: Partial<ReportedIssue> = {}): ReportedIssue => ({
  id, kind: 'general', reason: 'Example reported problem', status: 'open', ebookFormat: null,
  submittedAsin: null, book: null, target: null, canReplace: false, audiobook: null,
  reporter: { id: 'reader-1', plexUsername: 'reader', avatarUrl: null },
  createdAt: '2026-09-22T12:00:00Z', updatedAt: '2026-09-22T12:00:00Z', resolvedAt: null, resolvedById: null,
  ...overrides,
});

describe('ReportedIssuesSection', () => {
  it('renders nullable context, gates Replace to an authorized audio target, and safely dismisses a general report', async () => {
    fetchMock.mockResolvedValue({ success: true });
    const audio = issue('audio-1', {
      kind: 'audiobook', canReplace: true,
      audiobook: { id: 'book-1', title: 'Audio book', author: 'Example author', coverArtUrl: null, audibleAsin: 'B012345678' },
      target: { type: 'audiobook', backend: 'audiobookshelf', libraryItemId: 'library-1', asin: 'B012345678', match: 'sibling' },
    });
    render(<ReportedIssuesSection issues={[
      issue('general-1'),
      issue('ebook-1', { kind: 'ebook', ebookFormat: 'pdf', book: { id: null, asin: null, title: 'Ebook context', author: '', coverArtUrl: null } }),
      issue('unresolved-1', { kind: 'audiobook' }),
      audio,
    ]} />);

    expect(screen.getByText('General / not sure')).toBeInTheDocument();
    expect(screen.getByText('Ebook · PDF')).toBeInTheDocument();
    expect(screen.getByText('Ebook context')).toBeInTheDocument();
    expect(screen.getAllByText('Unresolved target')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Replace' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(4);

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Issue dismissed'));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/reported-issues/general-1/resolve', {
      method: 'POST', body: JSON.stringify({ action: 'dismiss' }),
    });
  });
});
