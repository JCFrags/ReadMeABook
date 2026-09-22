/**
 * Component: Shared Report Form Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReportIssueModal } from '@/components/audiobooks/ReportIssueModal';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'test-session' }),
}));
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchMock, fetchJSON: vi.fn() }));

const response = (body: unknown, status = 201) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('ReportIssueModal', () => {
  it('saves a global general report with no book and permits more than 250 characters', async () => {
    fetchMock.mockResolvedValue(response({ success: true, issue: { id: 'general-1' } }));
    render(<ReportIssueModal isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'General / not sure' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Audio' })).toBeDisabled();
    expect(screen.getByLabelText('Book title (optional)')).not.toBeRequired();
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeDisabled();
    expect(screen.getByLabelText('Describe the problem')).toHaveAttribute('maxlength', '2000');
    screen.getByRole('radio', { name: 'General / not sure' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    const reason = 'The page does not show the expected results. '.repeat(8);
    fireEvent.change(screen.getByLabelText('Describe the problem'), { target: { value: reason } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(await screen.findByText('Report saved')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reported-issues');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ kind: 'general', reason: reason.trim() });
    expect(screen.getByText('An administrator can review your report.')).toBeInTheDocument();
  });

  it('keeps useful audio errors and the draft, then submits a separate ebook report with the same context', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ message: 'An open audio report already exists.' }, 409))
      .mockResolvedValueOnce(response({ success: true, issue: { id: 'ebook-1' } }));
    render(<ReportIssueModal isOpen onClose={vi.fn()} asin="B012345678" bookTitle="Example book" bookAuthor="Example author" />);

    expect(screen.getByRole('radio', { name: 'Audio' })).toBeChecked();
    fireEvent.change(screen.getByLabelText('Describe the problem'), { target: { value: 'The final chapter is missing.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('An open audio report already exists.');
    expect(screen.queryByText('Report saved')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Describe the problem')).toHaveValue('The final chapter is missing.');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      kind: 'audiobook', reason: 'The final chapter is missing.', asin: 'B012345678',
      title: 'Example book', author: 'Example author',
    });

    fireEvent.click(screen.getByRole('radio', { name: 'Ebook' }));
    fireEvent.change(screen.getByLabelText('Ebook format'), { target: { value: 'pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    expect(await screen.findByText('Report saved')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      kind: 'ebook', ebookFormat: 'pdf', reason: 'The final chapter is missing.', asin: 'B012345678',
      title: 'Example book', author: 'Example author',
    });
  });
});
