/**
 * Component: Version Badge Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { VersionBadge } from '@/components/ui/VersionBadge';

const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
const originalCommit = process.env.NEXT_PUBLIC_GIT_COMMIT;

describe('VersionBadge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalVersion === undefined) {
      delete process.env.NEXT_PUBLIC_APP_VERSION;
    } else {
      process.env.NEXT_PUBLIC_APP_VERSION = originalVersion;
    }
    if (originalCommit === undefined) {
      delete process.env.NEXT_PUBLIC_GIT_COMMIT;
    } else {
      process.env.NEXT_PUBLIC_GIT_COMMIT = originalCommit;
    }
  });

  it('renders semantic version from build-time env var', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '1.0.0';
    process.env.NEXT_PUBLIC_GIT_COMMIT = 'abcdef1234';
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ version: '1.0.0' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<VersionBadge />);

    expect(await screen.findByText('v1.0.0 · Fork source')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://github.com/JCFrags/ReadMeABook/tree/abcdef1');
    // Should not call /api/version since build-time version is available
    expect(fetchMock).not.toHaveBeenCalledWith('/api/version');
  });

  it('falls back to API when build-time version is unavailable', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = 'unknown';
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ version: 'v1.2.3', commit: 'abc1234' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<VersionBadge />);

    expect(await screen.findByText('v1.2.3 · Fork source')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://github.com/JCFrags/ReadMeABook/tree/abc1234');
    expect(fetchMock).toHaveBeenCalledWith('/api/version');
  });

  it('shows dev version when API fetch fails', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = 'unknown';
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    const errorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    render(<VersionBadge />);

    await waitFor(() => {
      expect(screen.getByText('vDEV · Fork source')).toBeInTheDocument();
    });
    expect(errorMock).toHaveBeenCalledWith('Failed to fetch version:', expect.any(Error));
  });
});
