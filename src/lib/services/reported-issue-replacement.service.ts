/**
 * Component: Reported Audiobook Replacement
 * Documentation: documentation/backend/services/reported-issues.md
 */

import { prisma } from '@/lib/db';
import { RMABLogger } from '@/lib/utils/logger';
import type { ReportTarget } from '@/lib/types/reported-issues';
import { getReplacementTarget, ReportedIssueError } from './reported-issue-target.service';

const logger = RMABLogger.create('ReportedIssueReplacement');

/** Existing admin-only replacement workflow. Reporting itself never calls this. */
export async function replaceAudiobook(issueId: string, adminUserId: string, torrent: any) {
  const issue = await prisma.reportedIssue.findUnique({
    where: { id: issueId }, include: { audiobook: true },
  });
  if (!issue) throw new ReportedIssueError('Issue not found', 404);
  if (issue.status !== 'open') throw new ReportedIssueError('Issue is already resolved', 409);
  const target = await getReplacementTarget(issue);
  if (!target || !issue.audiobook) {
    throw new ReportedIssueError('Only an audiobook report with a confirmed library target can be replaced', 409);
  }
  const audiobook = issue.audiobook;
  const existingRequest = await prisma.request.findFirst({
    where: { audiobookId: audiobook.id, type: 'audiobook', deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  // Keep the existing request workflow. Its target was rechecked above.
  if (existingRequest) {
    const { deleteRequest } = await import('./request-delete.service');
    const result = await deleteRequest(existingRequest.id, adminUserId);
    if (!result.success) throw new ReportedIssueError('Could not remove the existing audiobook. Check the library before retrying.', 409);
  } else {
    await deleteFromLibrary(target);
  }

  await prisma.audiobook.update({
    where: { id: audiobook.id },
    data: {
      status: 'requested', plexGuid: null, absItemId: null, filePath: null,
      fileFormat: null, fileSizeBytes: null, filesHash: null,
    },
  });
  const newRequest = await prisma.request.create({
    data: { userId: adminUserId, audiobookId: audiobook.id, status: 'downloading', type: 'audiobook', progress: 0 },
    include: { audiobook: true, user: { select: { id: true, plexUsername: true } } },
  });
  const { getJobQueueService } = await import('./job-queue.service');
  await getJobQueueService().addDownloadJob(newRequest.id, {
    id: audiobook.id, title: audiobook.title, author: audiobook.author,
  }, torrent);
  await prisma.reportedIssue.update({
    where: { id: issueId }, data: { status: 'replaced', resolvedAt: new Date(), resolvedById: adminUserId },
  });
  logger.info('Reported audiobook replaced', { issueId, requestId: newRequest.id });
  return { issue, request: newRequest };
}

/** Use only the exact server-resolved library identity, not a path or ASIN substring. */
async function deleteFromLibrary(target: ReportTarget) {
  if (target.backend === 'audiobookshelf') {
    const { deleteABSItem } = await import('./audiobookshelf/api');
    await deleteABSItem(target.libraryItemId);
  } else {
    const library = await prisma.plexLibrary.findUnique({
      where: { plexGuid: target.libraryItemId }, select: { plexRatingKey: true },
    });
    const { getConfigService } = await import('./config.service');
    const config = getConfigService();
    const [url, token] = await Promise.all([config.get('plex_url'), config.get('plex_token')]);
    if (!library?.plexRatingKey || !url || !token) {
      throw new ReportedIssueError('The exact Plex library target is unavailable', 409);
    }
    const { getPlexService } = await import('../integrations/plex.service');
    await getPlexService().deleteItem(url, token, library.plexRatingKey);
  }
  await prisma.plexLibrary.deleteMany({ where: { plexGuid: target.libraryItemId } });
}
