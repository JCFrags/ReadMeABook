/**
 * Component: Explicit Collection File Mapping
 * Documentation: documentation/features/collection-workflow.md
 */

'use client';

import React, { useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/utils/api';
import type { TorrentResult } from '@/lib/utils/ranking-algorithm';
import type { CollectionPreview, CollectionSource } from '@/lib/collections/types';

const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const PAGE_SIZE = 100;

export function CollectionSelectionModal({ torrent, requestId, onClose, onSuccess }: {
  torrent: TorrentResult; requestId: string; onClose: () => void; onSuccess: () => void;
}) {
  const [source, setSource] = useState<CollectionSource>(
    torrent.indexerId ? { kind: 'prowlarr', downloadUrl: torrent.downloadUrl, indexerId: torrent.indexerId }
      : { kind: 'existing', infoHash: torrent.infoHash || '' },
  );
  const [existingHash, setExistingHash] = useState(torrent.infoHash || '');
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [selectedBooks, setSelectedBooks] = useState<string[]>([requestId]);
  const [activeBook, setActiveBook] = useState(requestId);
  const [assignments, setAssignments] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load(nextSource: CollectionSource) {
    setBusy(true); setError(''); setPreview(null); setAssignments({}); setConfirmed(false); setPage(0);
    try {
      const response = await fetchWithAuth('/api/admin/collections/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: nextSource, anchorRequestId: requestId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Preview failed');
      setSource(nextSource); setPreview(data);
      const first = data.books.some((book: { requestId: string }) => book.requestId === requestId) ? requestId : '';
      setSelectedBooks(first ? [first] : []); setActiveBook(first);
    } catch (err) { setError(err instanceof Error ? err.message : 'Preview failed'); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(source); }, []);

  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setError('Torrent metadata must be at most 4 MiB'); return; }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read torrent metadata');
    reader.onload = () => { void load({ kind: 'upload', torrentBase64: String(reader.result).split(',')[1] }); };
    reader.readAsDataURL(file);
  }

  const selectedFiles = preview?.files.filter(f => assignments[f.index]) || [];
  const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
  const visible = preview?.files.filter(file => file.path.toLowerCase().includes(filter.toLowerCase())) || [];
  const incompleteBooks = selectedBooks.filter(id => !selectedFiles.some(f => assignments[f.index] === id && f.kind === 'audio'));
  const overLimit = !!preview && (selectedBytes > preview.limits.maxSelectedBytes || selectedFiles.length > preview.limits.maxSelectedFiles);

  async function submit() {
    if (!preview) return;
    setBusy(true); setError('');
    try {
      const response = await fetchWithAuth('/api/admin/collections/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, expectedHash: preview.infoHash, expectedFingerprint: preview.fingerprint,
          identityConfirmed: confirmed, mappings: selectedBooks.map(id => ({ requestId: id,
            fileIndexes: selectedFiles.filter(f => assignments[f.index] === id).map(f => f.index) })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Selection failed');
      onSuccess();
    } catch (err) { setError(err instanceof Error ? err.message : 'Selection failed'); }
    finally { setBusy(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="collection-title" className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
      <div className="flex items-center justify-between border-b border-gray-300 dark:border-gray-700 p-4">
        <h3 id="collection-title" className="font-semibold">Select books from collection</h3>
        <button type="button" disabled={busy} onClick={onClose} className="px-3 py-1 disabled:opacity-40">Close</button>
      </div>
      <div className="overflow-y-auto flex-1 p-4 space-y-4">
        <p className="text-sm">Preview does not download audio. Map exact files to each requested book. No edition or narrator is selected automatically.</p>
        <p className="text-sm break-words">Release: {torrent.title}</p>
        <details className="text-sm border rounded p-3" open={!preview && !busy}>
          <summary>Use a .torrent file or existing torrent</summary>
          <label className="block mt-3">Upload metadata (4 MiB maximum)
            <input aria-label="Torrent metadata file" type="file" accept=".torrent" disabled={busy} onChange={e => void upload(e.target.files?.[0])} className="block mt-1" />
          </label>
          <label className="block mt-3">Existing qBittorrent info hash
            <input value={existingHash} onChange={e => setExistingHash(e.target.value.trim())} maxLength={40} className="block w-full border rounded p-2 dark:bg-gray-800" />
          </label>
          <button type="button" disabled={busy || !/^[a-f0-9]{40}$/i.test(existingHash)} onClick={() => void load({ kind: 'existing', infoHash: existingHash })} className="mt-2 text-blue-600 disabled:opacity-40">Preview existing files</button>
        </details>
        {busy && <p role="status">Checking collection...</p>}
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
        {preview && <>
          <div className="text-sm rounded border p-3 space-y-1">
            <p className="break-words">{preview.name}</p>
            <p>{preview.files.length} files, {size(preview.totalBytes)} in full torrent. {preview.existing ? 'Existing torrent will be reused.' : 'New torrent will be added stopped.'}</p>
            <p>Selection limit: {size(preview.limits.maxSelectedBytes)}, {preview.limits.maxSelectedFiles} files.</p>
            <p>Existing selected files remain selected. Unrelated incomplete selections block this operation.</p>
            <button type="button" disabled={busy} onClick={() => void load(source)} className="text-blue-600">Refresh preview (clears mapping)</button>
          </div>
          <label className="block text-sm">Book to map. Choose another request to add it to this selection.
            <select value={activeBook} disabled={busy} onChange={e => {
              const id = e.target.value; setActiveBook(id); setConfirmed(false);
              if (id && !selectedBooks.includes(id)) setSelectedBooks([...selectedBooks, id]);
            }} className="block w-full border rounded p-2 mt-1 dark:bg-gray-800">
              <option value="">Choose a requested book</option>
              {preview.books.map(book => <option key={book.requestId} value={book.requestId}>{book.title} — {book.author}{book.seriesPart ? ` (${book.seriesPart})` : ''}</option>)}
            </select>
          </label>
          <ul className="text-sm space-y-2">
            {selectedBooks.map(id => {
              const book = preview.books.find(b => b.requestId === id)!;
              return <li key={id} className="border rounded p-2">
                <p>{book.title}. Narrator: {book.narrator || 'Unverified'}. {book.series} {book.seriesPart}</p>
                <p>{selectedFiles.filter(f => assignments[f.index] === id).length} files assigned{incompleteBooks.includes(id) ? '. Missing audio selection.' : '.'}</p>
                <button type="button" disabled={busy} className="text-red-600" onClick={() => {
                  setSelectedBooks(selectedBooks.filter(bookId => bookId !== id));
                  setAssignments(Object.fromEntries(Object.entries(assignments).filter(([, bookId]) => bookId !== id)));
                  if (activeBook === id) setActiveBook(''); setConfirmed(false);
                }}>Remove book from this selection</button>
              </li>;
            })}
          </ul>
          <label className="block text-sm">Filter file paths
            <input value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }} className="block w-full border rounded p-2 dark:bg-gray-800" />
          </label>
          <p className="text-xs">Check files to assign them to the chosen book. Cover and EPUB/PDF companion files must be beside that book&apos;s audio. Archives and protected audio are not selectable.</p>
          <div className="space-y-1">
            {visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(file => <label key={file.index} className={`flex items-start gap-2 text-xs border-b p-2 ${file.kind === 'unsupported' ? 'opacity-50' : ''}`}>
              <input type="checkbox" disabled={busy || !activeBook || file.kind === 'unsupported'} checked={!!assignments[file.index]} onChange={e => {
                const next = { ...assignments }; if (e.target.checked) next[file.index] = activeBook; else delete next[file.index];
                setAssignments(next); setConfirmed(false);
              }} />
              <span className="min-w-0 break-words">{file.path} ({size(file.size)}, {file.kind})
                {file.priority > 0 && ' — previously selected'}
                {assignments[file.index] && <span className="block text-blue-600">Mapped to: {preview.books.find(b => b.requestId === assignments[file.index])?.title}</span>}
              </span>
            </label>)}
          </div>
          <div className="flex gap-4 text-sm">
            <button disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page + 1} of {Math.max(1, Math.ceil(visible.length / PAGE_SIZE))}</span>
            <button disabled={(page + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage(page + 1)}>Next</button>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
            I verified the volume, edition, narrator, language, and completeness for every selected book, and selected only its audio and appropriate companion files.
          </label>
        </>}
      </div>
      <div className="border-t border-gray-300 dark:border-gray-700 p-4 flex items-center justify-between gap-3">
        <p className={`text-sm ${overLimit ? 'text-red-600' : ''}`}>{selectedFiles.length} files, {size(selectedBytes)}{overLimit ? '. Limit exceeded.' : ''}</p>
        <button type="button" onClick={() => void submit()} disabled={busy || !preview || !confirmed || !selectedBooks.length || incompleteBooks.length > 0 || overLimit}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-40">Start selected files</button>
      </div>
    </div>
  );
}
