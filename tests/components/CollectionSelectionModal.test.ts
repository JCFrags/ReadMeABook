/**
 * @vitest-environment jsdom
 * Component: Collection Mapping Interaction Check
 * Documentation: documentation/features/collection-workflow.md
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CollectionSelectionModal } from '@/components/requests/CollectionSelectionModal';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchMock }));

describe('CollectionSelectionModal', () => {
  it('requires explicit audio and identity confirmation and sends only checked file indexes', async () => {
    const sourceFile = { index: 0, path: 'Pack/One/audio.mp3', size: 10, kind: 'audio', priority: 0, progress: 0 };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({
      infoHash: 'a'.repeat(40), name: 'Pack', fingerprint: 'b'.repeat(64), existing: false, totalBytes: 20,
      limits: { maxSelectedBytes: 100, maxSelectedFiles: 10 },
      files: [sourceFile, { ...sourceFile, index: 1, path: 'Pack/Two/audio.mp3' }],
      books: [{ requestId: 'request-one', title: 'Book One', author: 'Author', narrator: null, series: 'Series', seriesPart: '1' }],
    }) });
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    const onSuccess = vi.fn();
    render(React.createElement(CollectionSelectionModal, { requestId: 'request-one', onSuccess, onClose: vi.fn(),
      torrent: { indexer: 'Indexer', indexerId: 1, title: 'Collection', size: 999999, publishDate: new Date(), downloadUrl: 'https://indexers.example/1/download', guid: 'release-one' },
    }));
    const start = screen.getByRole('button', { name: 'Start selected files' });
    expect(start).toBeDisabled();
    fireEvent.click(await screen.findByLabelText(/Pack\/One\/audio.mp3/));
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I verified the volume/));
    expect(start).not.toBeDisabled();
    fireEvent.click(start);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.mappings).toEqual([{ requestId: 'request-one', fileIndexes: [0] }]);
    expect(body).not.toHaveProperty('selectedBytes');
  });
});
