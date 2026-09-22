/**
 * Component: Legacy Series Search Redirect
 * Documentation: documentation/frontend/components.md
 */

import { redirect } from 'next/navigation';

export default async function SeriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  const query = Array.isArray(q) ? q[0] : q;
  redirect(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
}
